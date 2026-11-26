import { CreateMicrovmAuthTokenCommand, TerminateMicrovmCommand } from '@aws-sdk/client-lambda-microvms';
import { vmClient } from './clients';
import type { StoredTask } from './types';

/** Mint a short-lived token for the computer server port (8080). */
export async function vmToken(vmId: string): Promise<string> {
  const tok: any = await vmClient.send(
    new CreateMicrovmAuthTokenCommand({ microvmIdentifier: vmId, allowedPorts: [{ port: 8080 }], expirationInMinutes: 15 }),
  );
  const token = tok?.authToken?.['X-aws-proxy-auth'] ?? '';
  if (!token) throw new Error('VM token mint failed');
  return token;
}

/**
 * Health gate: the dev server inside the task VM must answer 200 through the
 * computer's /dev reverse-proxy. No VM (pre-build era) → pass with a note;
 * once real builds land every task has a VM and the gate always enforces.
 */
export async function checkDevServer(task: StoredTask): Promise<string> {
  if (!task.vm?.vmId || !task.vm?.endpoint || task.vm.terminatedAt) {
    return 'no sandbox — pre-build submit, health not verified';
  }
  const token = await vmToken(task.vm.vmId);
  const res = await fetch(`https://${task.vm.endpoint}/dev/?port=5173`, {
    headers: { 'X-aws-proxy-auth': token },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res || res.status !== 200) {
    throw new Error(`dev server not answering (status ${res?.status ?? 'unreachable'}) — start npm run dev in the sandbox before submitting`);
  }
  return `dev server 200 via /dev (checked ${new Date().toISOString()})`;
}

/** Best-effort VM termination; records terminatedAt, never throws. */
export async function terminateVm(task: StoredTask): Promise<string> {
  if (!task.vm?.vmId || task.vm.terminatedAt) return 'no live VM';
  let flushNote = '';
  if (task.vm.endpoint) {
    try {
      await flushVmBackup(task.vm.vmId, task.vm.endpoint);
      flushNote = 'final backup flushed; ';
    } catch (e) {
      flushNote = `final backup FAILED (${e instanceof Error ? e.message : String(e)}); `;
    }
  }
  try {
    await vmClient.send(new TerminateMicrovmCommand({ microvmIdentifier: task.vm.vmId }));
    task.vm.terminatedAt = new Date().toISOString();
    return `${flushNote}VM terminated at ${task.vm.terminatedAt}`;
  } catch (e) {
    return `${flushNote}VM terminate failed (sweep manually): ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Flush-first backup: ask the VM to run its terminate hook (final workspace
 * push to S3) BEFORE the platform kills it. TerminateMicrovmCommand alone
 * does not reliably fire the hook (observed: no hook, no backup), so every
 * terminate path must flush explicitly — mirroring the suspend paths.
 * Throws on flush failure; callers decide block vs proceed.
 */
export async function flushVmBackup(vmId: string, endpoint: string, timeoutMs = 120_000): Promise<string> {
  const token = await vmToken(vmId);
  const res = await fetch(`https://${endpoint}/hooks/terminate`, {
    method: 'POST',
    headers: { 'X-aws-proxy-auth': token, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const out: any = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) {
    throw new Error(`backup flush failed: ${JSON.stringify(out).slice(0, 200)}`);
  }
  return 'final backup flushed';
}
