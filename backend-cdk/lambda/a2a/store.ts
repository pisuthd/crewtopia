import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from './clients';
import type { StoredTask } from './types';

/**
 * Atomic funding→working flip. Only the first concurrent observer wins;
 * losers get null and must skip boot + announcements (kills duplicate
 * sandbox boots and duplicate thread messages from overlapping polls).
 */
export async function tryFlipToWorking(taskId: string): Promise<StoredTask | null> {
  const now = new Date().toISOString();
  try {
    const out = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { taskId },
        UpdateExpression: 'SET #s = :w, workingSince = if_not_exists(workingSince, :now)',
        ConditionExpression: '#s = :f',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':w': 'working', ':f': 'funding', ':now': now },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return out.Attributes as StoredTask;
  } catch (e: any) {
    if (e?.name === 'ConditionalCheckFailedException') return null;
    throw e;
  }
}

export async function getTask(taskId: string): Promise<StoredTask | undefined> {
  const out = await ddb.send(new GetCommand({ TableName: TABLE, Key: { taskId } }));
  return out.Item as StoredTask | undefined;
}

export async function putTask(task: StoredTask): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: task }));
}

/** Multi-turn resume: resending with the same contextId continues the existing submitted task. */
export async function findSubmittedByContext(contextId: string): Promise<StoredTask | null> {
  const found = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'contextId = :c',
      ExpressionAttributeValues: { ':c': contextId },
      Limit: 1,
    }),
  );
  const candidate = (found.Items ?? [])[0] as StoredTask | undefined;
  return candidate && candidate.status === 'submitted' && !candidate.jobId ? candidate : null;
}

/** Any active rental for a buyer (one-team gate): working or funding,
 * regardless of VM state — closes the double-accept race while booting. */
export async function findActiveRentalByBuyer(buyer: string): Promise<StoredTask | null> {
  const found = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'buyer = :b AND viaEmber = :v',
      ExpressionAttributeValues: { ':b': buyer.toLowerCase(), ':v': true },
    }),
  );
  const items = ((found.Items ?? []) as StoredTask[]).filter(
    (t) => t.status === 'working' || t.status === 'funding',
  );
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items[0] ?? null;
}

/** Active Ember rental for a buyer (one team at a time — latest wins).
 * Pre-gate leftovers may still exist; they stay queryable by id but only
 * the latest drives the roster, member chat, and VM attach. */
export async function findCrewsByBuyer(buyer: string): Promise<StoredTask[]> {
  const found = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'buyer = :b AND viaEmber = :v',
      ExpressionAttributeValues: { ':b': buyer.toLowerCase(), ':v': true },
    }),
  );
  const items = ((found.Items ?? []) as StoredTask[]).filter(
    (t) => t.status === 'working' || t.status === 'funding',
  );
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items.slice(0, 1);
}

/** Latest live Ember rental for a buyer (member chat resolves its task). */
export async function findWorkingByBuyer(buyer: string): Promise<StoredTask | null> {
  const found = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'buyer = :b AND viaEmber = :v',
      ExpressionAttributeValues: { ':b': buyer.toLowerCase(), ':v': true },
    }),
  );
  const items = ((found.Items ?? []) as StoredTask[]).filter(
    (t) =>
      (t.status === 'working' || t.status === 'funding') &&
      !!t.vm?.vmId &&
      !!t.vm?.endpoint &&
      !t.vm?.terminatedAt,
  );
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items[0] ?? null;
}

/** Any live VM for a buyer across their tasks — one sandbox per wallet. */
export async function findLiveVmForBuyer(buyer: string): Promise<StoredTask | null> {
  const found = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'buyer = :b',
      ExpressionAttributeValues: { ':b': buyer.toLowerCase() },
    }),
  );
  const now = Date.now();
  const items = ((found.Items ?? []) as StoredTask[]).filter((t) => {
    if (!t.vm?.vmId || !t.vm?.endpoint || t.vm.terminatedAt || t.vm.suspendedAt) return false;
    if (t.status !== 'working' && t.status !== 'funding') return false;
    const start = new Date(t.workingSince ?? t.createdAt).getTime();
    const budget = (t.quote?.fundedSeconds ?? 0) * 1000;
    return Number.isFinite(start) && now - start < budget;
  });
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items[0] ?? null;
}

/** Latest suspended VM for a buyer (resume candidate — files survive suspend). */
export async function findSuspendedVmForBuyer(buyer: string): Promise<StoredTask | null> {
  const found = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'buyer = :b',
      ExpressionAttributeValues: { ':b': buyer.toLowerCase() },
    }),
  );
  const items = ((found.Items ?? []) as StoredTask[]).filter(
    (t) => !!t.vm?.vmId && !!t.vm?.suspendedAt && !t.vm?.terminatedAt,
  );
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items[0] ?? null;
}

/** Latest unfunded Ember rental for a buyer (drives the in-chat Fund card).
 * Matches fresh quotes (submitted, no job) and mid-funding reloads
 * (funding with a jobId) so the card can resume. */
export async function findPendingByBuyer(buyer: string): Promise<StoredTask | null> {
  const found = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'buyer = :b AND viaEmber = :v',
      ExpressionAttributeValues: { ':b': buyer.toLowerCase(), ':v': true },
    }),
  );
  const items = ((found.Items ?? []) as StoredTask[]).filter(
    (t) => t.quote && ((t.status === 'submitted' && !t.jobId) || (t.status === 'funding' && !!t.jobId)),
  );
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items[0] ?? null;
}
