import { getTask, putTask } from './store';
import { verifyBinding } from './accept';
import { terminateVm } from './vm';
import { agentText, rpc, rpcError } from './rpc';
import { randomUUID } from 'node:crypto';

// crew-end: end a rental early. Mirrors the app panel terminate exactly:
// the clock stops, crew chat hard-stops (status leaves 'working'), the
// one-team slot frees. Escrow stays locked per job until expiry — settle
// delivered work with web3-deliver, or claimRefund on-chain after expiry.
export async function handleEnd(id: unknown, data: any) {
  const taskId = String(data.task_id ?? '');
  if (!taskId) return rpcError(id, -32602, 'crew-end needs a task_id');
  let buyer: string;
  try {
    buyer = (await verifyBinding(data)).toLowerCase();
  } catch (e) {
    return rpcError(id, -32602, e instanceof Error ? e.message : 'binding failed');
  }
  const task = await getTask(taskId);
  if (!task) {
    return rpc(id, agentText('missing', randomUUID(), `No task ${taskId} on this team. Negotiate first.`));
  }
  if (!task.buyer || task.buyer.toLowerCase() !== buyer) {
    return rpcError(id, -32602, 'task is not bound to this buyer wallet');
  }
  if (task.status === 'ended' || task.endedAt) {
    return rpc(id, { task_id: taskId, state: 'ended', note: 'already ended' });
  }
  let note: string;
  if (!task.vm?.vmId || task.vm.terminatedAt) {
    note = 'rental ended (no task VM to terminate)';
  } else {
    note = await terminateVm(task);
  }
  task.status = 'ended';
  task.endedAt = new Date().toISOString();
  await putTask(task);
  // Voice rentals: detach the VM voice server + delete the Speech Engine
  // (best-effort — the call already ended from the buyer's side).
  if ((task as any).voiceEngineId) {
    const { teardownVoice } = await import('../voice');
    await teardownVoice(taskId, buyer).catch(() => {});
  }
  return rpc(id, {
    task_id: taskId,
    state: 'ended',
    note: `${note}. Escrow stays locked per job — settle delivered work, or claimRefund after expiry.`,
  });
}
