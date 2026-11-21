import { randomUUID } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { getEscrow } from './clients';
import { findActiveRentalByBuyer, getTask, putTask } from './store';
import { bindMessage } from './messages';
import { agentText, rpc, rpcError } from './rpc';
import type { StoredTask } from './types';

/** Verify an EIP-191 binding triple; returns the bound address or throws. */
export async function verifyBinding(data: any): Promise<string> {
  if (!data.buyerAddress || !data.nonce || !data.buyerSig) {
    throw new Error('accept needs { buyerAddress, nonce, buyerSig } — sign the binding message first (see negotiate hint)');
  }
  const recovered = await recoverMessageAddress({
    message: bindMessage(String(data.buyerAddress), String(data.nonce)),
    signature: data.buyerSig as `0x${string}`,
  });
  if (recovered.toLowerCase() !== String(data.buyerAddress).toLowerCase()) {
    throw new Error('buyerSig does not match buyerAddress');
  }
  return recovered;
}

/** Shared pre-chain gates (binding match, explicit minutes, one team). */
async function checkGates(
  task: StoredTask,
  buyer: string,
): Promise<string | null> {
  const taskId = task.taskId;
  if (task.status !== 'submitted' || !task.quote) {
    return `Task ${taskId} is ${task.status} — only submitted tasks with a quote can be accepted`;
  }
  if (task.buyer && task.buyer.toLowerCase() !== buyer.toLowerCase()) {
    return 'task is bound to a different buyer wallet';
  }
  if (task.viaEmber && task.minutesSource !== 'explicit') {
    return 'task has no confirmed rental time — confirm minutes before accepting';
  }
  if (task.viaEmber) {
    const live = await findActiveRentalByBuyer(buyer);
    if (live && live.taskId !== taskId) {
      return `crew already active on task ${live.taskId} — renew it instead of hiring a second team`;
    }
  }
  return null;
}

/** Chain half of accept: create + register + setBudget, then mark funding. */
export async function finishAccept(
  task: StoredTask,
  buyer: string,
): Promise<{ jobId: string; provider: string; token: string }> {
  const { client: escrow, provider } = await getEscrow();
  // Rental expiry: funded window + 1h grace for submit/settle. Unused
  // escrow returns via claimRefund after expiry; buyers chain sessions
  // via contextId rather than one long job.
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + task.quote!.fundedSeconds + 3600);
  const created = await escrow.createJob({
    provider,
    expiredAt,
    description: JSON.stringify({ taskId: task.taskId, brief: task.brief.slice(0, 280), team: task.quote!.team, chunks: task.quote!.chunks, totalU: task.quote!.totalU }),
  });
  if (created.jobId === null) throw new Error('createJob did not return a jobId');
  const jobId = created.jobId.toString();
  await escrow.registerJob(created.jobId);
  await escrow.setBudget(created.jobId, BigInt(task.quote!.totalWei));
  task.buyer = buyer.toLowerCase();
  task.jobId = jobId;
  task.status = 'funding';
  await putTask(task);
  const token = await escrow.paymentToken();
  return { jobId, provider, token };
}

function acceptedReply(task: StoredTask, buyer: string, jobId: string, provider: string, token: string) {
  return agentText(
    task.taskId,
    task.contextId,
    `Quote accepted. Escrow job ${jobId} created (provider ${provider}). Fund ${task.quote!.totalU} U ` +
      `of ${token} via fund(${jobId}, ${task.quote!.totalWei}) from ${buyer}, then poll web3-task-status — ` +
      `the task flips to WORKING once FUNDED is observed on-chain.`,
    [{ artifactId: randomUUID(), name: 'escrow', parts: [{ kind: 'data', data: { jobId, priceWei: task.quote!.totalWei, token, provider } }] }],
  );
}

export async function handleAccept(id: unknown, data: any) {
  // Buyer accepts the quoted total. Server (provider) creates the ERC-8183
  // job: create + register + setBudget. Buyer funds on-chain afterwards;
  // status flips to WORKING once FUNDED is observed (lazy, on status poll).
  const taskId = String(data.task_id ?? '');
  if (!taskId) return rpcError(id, -32602, 'accept-web3-quote needs a task_id');
  const task = await getTask(taskId);
  if (!task) {
    return rpc(id, agentText('missing', randomUUID(), `No task ${taskId} on this team. Negotiate first.`));
  }
  let buyer: string;
  try {
    buyer = (await verifyBinding(data)).toLowerCase();
  } catch (e) {
    return rpcError(id, -32602, e instanceof Error ? e.message : 'binding failed');
  }
  const blocked = await checkGates(task, buyer);
  if (blocked) return rpcError(id, -32602, blocked);
  try {
    const done = await finishAccept(task, buyer);
    return rpc(id, acceptedReply(task, buyer, done.jobId, done.provider, done.token));
  } catch (e) {
    return rpcError(id, -32603, `escrow setup failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Async finish for the app flow: chain work without the 29s gateway clock.
 * Gates re-checked; binding already verified by the caller. */
export async function handleAcceptFinish(taskId: string): Promise<{ jobId: string } | { error: string }> {
  const task = await getTask(taskId);
  if (!task || !task.quote) return { error: `no quotable task ${taskId}` };
  const buyer = (task.buyer ?? '').toLowerCase();
  if (!buyer) return { error: 'task has no buyer yet' };
  const blocked = await checkGates(task, buyer);
  if (blocked) return { error: blocked };
  if (task.jobId) return { jobId: task.jobId };
  try {
    const done = await finishAccept(task, buyer);
    return { jobId: done.jobId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'accept-finish failed' };
  }
}
