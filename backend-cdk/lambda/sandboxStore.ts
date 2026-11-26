// Per-wallet sandbox records (option B) — free personal workspaces, no rental.
// Keyed by wallet; computerId is STABLE per wallet (sb-<addr>) so backup keys
// (backups/{computerId}/{path}) survive VM replacement: terminate → new VM
// pulls the same backup. Rental task flows never read this table.
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetMicrovmCommand, ResumeMicrovmCommand, SuspendMicrovmCommand, TerminateMicrovmCommand } from '@aws-sdk/client-lambda-microvms';
import { vmClient } from './a2a/clients';
import { flushVmBackup, vmToken } from './a2a/vm';
import { findLiveVmForBuyer } from './a2a/store';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.SANDBOX_TABLE ?? '';

export interface SandboxVm {
  vmId?: string;
  endpoint?: string;
  bootedAt?: string;
  suspendedAt?: string;
  terminatedAt?: string;
}

export interface SandboxRecord {
  wallet: string;
  computerId: string;
  status: 'live' | 'suspended' | 'terminated' | 'booting';
  vm?: SandboxVm;
  createdAt: string;
  updatedAt: string;
}

export const computerIdFor = (wallet: string) => `sb-${wallet.toLowerCase().slice(2, 10)}`;
export const usageTokenFor = (computerId: string) => `crewtopia-${computerId.slice(0, 8)}`;

function table(): string {
  if (!TABLE) throw new Error('server misconfigured: SANDBOX_TABLE is not set');
  return TABLE;
}

export async function getSandbox(wallet: string): Promise<SandboxRecord | null> {
  const out = await ddb.send(new GetCommand({ TableName: table(), Key: { wallet: wallet.toLowerCase() } }));
  return (out.Item as SandboxRecord) ?? null;
}

export async function putSandbox(rec: SandboxRecord): Promise<void> {
  rec.updatedAt = new Date().toISOString();
  await ddb.send(new PutCommand({ TableName: table(), Item: rec }));
}

export async function findSandboxByComputerId(computerId: string): Promise<SandboxRecord | null> {
  const out = await ddb.send(
    new ScanCommand({ TableName: table(), FilterExpression: 'computerId = :c', ExpressionAttributeValues: { ':c': computerId } }),
  );
  const items = (out.Items ?? []) as SandboxRecord[];
  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return items[0] ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Suspend a sandbox VM (files survive suspend; resume restores them). */
export async function suspendSandboxVm(rec: SandboxRecord): Promise<string> {
  if (!rec.vm?.vmId || rec.vm.terminatedAt || rec.vm.suspendedAt) return 'already suspended or gone';
  console.log(`[sandbox] suspend ${rec.vm.vmId} (computer ${rec.computerId})`);
  try {
    await vmClient.send(new SuspendMicrovmCommand({ microvmIdentifier: rec.vm.vmId }));
    rec.vm.suspendedAt = new Date().toISOString();
    rec.status = 'suspended';
    await putSandbox(rec);
    console.log(`[sandbox] suspended ${rec.vm.vmId}`);
    return 'suspended';
  } catch (e) {
    return `suspend failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Resume a suspended sandbox VM and wait for RUNNING. */
export async function resumeSandboxVm(rec: SandboxRecord): Promise<void> {
  if (!rec.vm?.vmId || rec.vm.terminatedAt || !rec.vm.suspendedAt) return;
  await vmClient.send(new ResumeMicrovmCommand({ microvmIdentifier: rec.vm.vmId }));
  for (let i = 0; i < 24; i++) {
    await sleep(10000);
    const got: any = await vmClient.send(new GetMicrovmCommand({ microvmIdentifier: rec.vm!.vmId }));
    if (got.endpoint && /running/i.test(JSON.stringify(got.state))) {
      rec.vm.endpoint = got.endpoint;
      delete rec.vm.suspendedAt;
      rec.status = 'live';
      await putSandbox(rec);
      return;
    }
  }
  throw new Error('VM did not resume in time');
}

/** Mint a short-lived auth token for a sandbox VM. */
export async function sandboxVmToken(rec: SandboxRecord): Promise<string> {
  if (!rec.vm?.vmId) throw new Error('no VM for this sandbox');
  return vmToken(rec.vm.vmId);
}

/** Terminate a sandbox VM; record stays for history (boot starts fresh). */
export async function terminateSandboxVm(rec: SandboxRecord): Promise<string> {
  if (!rec.vm?.vmId || rec.vm.terminatedAt) return 'already gone';
  // Flush-first: the platform does not reliably fire the terminate hook, so
  // push the workspace BEFORE killing the VM (mirrors the suspend paths).
  // Best-effort — a failed flush is reported, never blocks the kill.
  // Suspended VMs are unreachable; skip straight to terminate.
  let flushNote = '';
  if (rec.vm.endpoint && !rec.vm.suspendedAt) {
    try {
      await flushVmBackup(rec.vm.vmId, rec.vm.endpoint);
      flushNote = 'final backup flushed; ';
    } catch (e) {
      flushNote = `final backup FAILED (${e instanceof Error ? e.message : String(e)}); `;
    }
  }
  try {
    await vmClient.send(new TerminateMicrovmCommand({ microvmIdentifier: rec.vm.vmId }));
  } catch (e) {
    return `${flushNote}terminate failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  rec.vm.terminatedAt = new Date().toISOString();
  delete rec.vm.suspendedAt;
  rec.status = 'terminated';
  await putSandbox(rec);
  return `${flushNote}terminated`;
}

/** Live sandbox VM for an owner: sandbox table first, legacy rental lookup fallback. */
export async function resolveSandboxVm(owner: string): Promise<{ vmId: string; endpoint: string } | null> {
  const rec = await getSandbox(owner.toLowerCase()).catch(() => null);
  if (rec?.vm?.vmId && rec.vm.endpoint && !rec.vm.suspendedAt && !rec.vm.terminatedAt) {
    return { vmId: rec.vm.vmId, endpoint: rec.vm.endpoint };
  }
  const live = await findLiveVmForBuyer(owner.toLowerCase()).catch(() => null);
  if (live?.vm?.vmId && live.vm.endpoint && !live.vm.suspendedAt && !live.vm.terminatedAt) {
    return { vmId: live.vm.vmId, endpoint: live.vm.endpoint };
  }
  return null;
}
