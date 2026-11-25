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

/**
 * Targeted writes (Fix D). Whole-task putTask read-modify-write cycles wipe
 * each other's crewRuns (supervisor vs starter vs add-member vs renewal
 * credit) → phantom re-kicks where the crew greets again and again. These
 * updates never read, so they can't go stale; concurrent writers to
 * different roles/fields don't clobber each other.
 */

/** Track one started member run; keeps the first writer (starter wins). */
export async function trackCrewRun(
  taskId: string,
  role: string,
  run: { runId: string; startedAt: string; nudges: number },
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { taskId },
      UpdateExpression: 'SET #cr.#r = if_not_exists(#cr.#r, :run)',
      ExpressionAttributeNames: { '#cr': 'crewRuns', '#r': role },
      ExpressionAttributeValues: { ':run': run },
    }),
  );
}

/** Overwrite one tracked run (supervisor cursor/done, lead nudge). */
export async function setCrewRun(
  taskId: string,
  role: string,
  run: { runId: string; startedAt: string; nudges: number; cursor?: number; done?: boolean },
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { taskId },
      UpdateExpression: 'SET #cr.#r = :run',
      ExpressionAttributeNames: { '#cr': 'crewRuns', '#r': role },
      ExpressionAttributeValues: { ':run': run },
    }),
  );
}

/** Append one roster member atomically (mid-rental add). */
export async function appendRosterMember(
  taskId: string,
  member: { role: string; name: string; title: string; brief: string },
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { taskId },
      UpdateExpression: 'SET #roster = list_append(if_not_exists(#roster, :empty), :one)',
      ExpressionAttributeNames: { '#roster': 'roster' },
      ExpressionAttributeValues: { ':empty': [], ':one': [member] },
    }),
  );
}

/** Top-level touch (lastCrewCheck etc.) without a whole-task write. */
export async function touchTask(taskId: string, patch: Record<string, unknown>): Promise<void> {
  const names: Record<string, string> = {};
  const vals: Record<string, unknown> = {};
  const sets = Object.entries(patch).map(([k, v], i) => {
    names[`#f${i}`] = k;
    vals[`:v${i}`] = v;
    return `#f${i} = :v${i}`;
  });
  if (sets.length === 0) return;
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { taskId },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: vals as Record<string, any>,
    }),
  );
}

/**
 * Credit a funded renewal once. The old read-modify-write could double-credit
 * when two status polls raced: both saw renewalJobId set, both added. The
 * condition makes only the first writer win; losers skip.
 */
export async function creditRenewal(taskId: string, renewalJobId: string, addSeconds: number): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { taskId },
        UpdateExpression: 'SET #q.#f = #q.#f + :add, #r = :null',
        ConditionExpression: '#r = :rid',
        ExpressionAttributeNames: { '#q': 'quote', '#f': 'fundedSeconds', '#r': 'renewalJobId' },
        ExpressionAttributeValues: { ':add': addSeconds, ':rid': renewalJobId, ':null': null },
      }),
    );
    return true;
  } catch (e: any) {
    if (e?.name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
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

/** Active app rental for a buyer (one team at a time — latest wins).
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

/** Latest live app rental for a buyer (member chat resolves its task). */
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

/** Task owning a guest share link (Scan — guest links are low-volume). */
export async function findTaskByGuestLink(linkId: string): Promise<StoredTask | null> {
  if (!linkId) return null;
  const found = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'guestLinkId = :l',
      ExpressionAttributeValues: { ':l': linkId },
    }),
  );
  const items = ((found.Items ?? []) as StoredTask[]).filter((t) => t.status === 'working' && !t.endedAt);
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items[0] ?? null;
}

/** Latest rental with a source-zip handoff (uploaded via deliver tool).
 * Submit is the official handoff, but the buyer owns the rental output as soon
 * as the crew uploads it — submitted/completed carry the minted URL, working
 * rentals are checked live in S3. */
export async function findSubmittedByBuyer(buyer: string): Promise<StoredTask | null> {
  const found = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'buyer = :b',
      ExpressionAttributeValues: { ':b': buyer.toLowerCase() },
    }),
  );
  const items = ((found.Items ?? []) as StoredTask[]).filter(
    (t) =>
      (t.status === 'submitted' || t.status === 'completed') &&
      !!(t.deliverable as any)?.downloadUrl,
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

/** Latest unfunded app rental for a buyer (drives the in-chat Fund card).
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
