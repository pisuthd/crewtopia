import { getTask, putTask } from './store';
import { verifyBinding } from './accept';
import { buildQuote } from '../pricelist';
import { agentText, rpc, rpcError } from './rpc';
import { randomUUID } from 'node:crypto';

// crew-extend: top up a live rental. Sets pendingRenewal on the same task;
// the existing accept-web3-quote flow mints the renewal escrow job, the
// buyer funds it, and web3-task-status credits the clock on FUNDED.
// Mirrors the app's quote-with-renewTaskId flow (same math, same accept path).
export async function handleExtend(id: unknown, data: any) {
  const taskId = String(data.task_id ?? '');
  if (!taskId) return rpcError(id, -32602, 'crew-extend needs a task_id');
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
  if (task.status !== 'working') {
    return rpcError(id, -32602, `rental is ${task.status} — only live rentals can be topped up`);
  }
  const minutes = Number(data.minutes ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return rpcError(id, -32602, 'crew-extend needs a positive minutes number');
  }
  const quote = buildQuote('', undefined, minutes);
  task.pendingRenewal = {
    fundedSeconds: quote.fundedSeconds,
    chunks: quote.chunks,
    totalU: quote.totalU,
    totalWei: quote.totalWei,
    createdAt: new Date().toISOString(),
  };
  await putTask(task);
  const mins = Math.round(quote.fundedSeconds / 60);
  return rpc(id, {
    task_id: taskId,
    renewal: true,
    minutes: mins,
    chunks: quote.chunks,
    totalU: quote.totalU,
    totalWei: quote.totalWei,
    next: `Call accept-web3-quote with this task_id (+ same buyer triple) for renewal escrow params, anchor + fund the renewal job from your wallet, report via crew-report-job, and the rental clock extends once FUNDED is observed.`,
  });
}
