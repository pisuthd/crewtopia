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
  const renewing = !!task.pendingRenewal;
  if (!renewing && (task.status !== 'submitted' || !task.quote)) {
    return `Task ${taskId} is ${task.status} — only submitted tasks with a quote can be accepted`;
  }
  if (renewing && !task.quote) {
    return `Task ${taskId} has no rental to top up`;
  }
  if (task.buyer && task.buyer.toLowerCase() !== buyer.toLowerCase()) {
    return 'task is bound to a different buyer wallet';
  }
  if (task.viaEmber && task.minutesSource !== 'explicit' && !renewing) {
    return 'task has no confirmed rental time — confirm minutes before accepting';
  }
  if (task.viaEmber) {
    const live = await findActiveRentalByBuyer(buyer);
    if (live && live.taskId !== taskId) {
      return `crew already active on task ${live.taskId} — extend it instead of hiring a second team (in the app: team button → Extend)`;
    }
    if (renewing && (!live || live.taskId !== taskId)) {
      return 'renewal target is no longer the active rental — hire fresh instead';
    }
  }
  if (renewing && task.status !== 'working') {
    return `rental is ${task.status} — only live rentals can be topped up`;
  }
  return null;
}

/** Chain half of accept: create + register + setBudget, then mark funding.
 * Renewals (task.pendingRenewal) mint a second escrow job on the SAME task —
 * status stays working, the clock extends when FUNDED is observed. */
export async function finishAccept(
  task: StoredTask,
  buyer: string,
): Promise<{ jobId: string; provider: string; token: string }> {
  const { client: escrow, provider } = await getEscrow();
  const renewal = task.pendingRenewal;
  const fundedSeconds = renewal ? renewal.fundedSeconds : task.quote!.fundedSeconds;
  const totalWei = renewal ? renewal.totalWei : task.quote!.totalWei;
  // Rental expiry: funded window + 1h grace for submit/settle. Unused
  // escrow returns via claimRefund after expiry; buyers chain sessions
  // via contextId rather than one long job.
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + fundedSeconds + 3600);
  const description = renewal
    ? JSON.stringify({ taskId: task.taskId, renewal: true, chunks: renewal.chunks, totalU: renewal.totalU })
    : JSON.stringify({ taskId: task.taskId, brief: task.brief.slice(0, 280), team: task.quote!.team, chunks: task.quote!.chunks, totalU: task.quote!.totalU });
  const created = await escrow.createJob({ provider, expiredAt, description });
  if (created.jobId === null) throw new Error('createJob did not return a jobId');
  const jobId = created.jobId.toString();
  await escrow.registerJob(created.jobId);
  await escrow.setBudget(created.jobId, BigInt(totalWei));
  task.buyer = buyer.toLowerCase();
  const token = await escrow.paymentToken();
  if (renewal) {
    task.renewalJobs = [
      ...(task.renewalJobs ?? []),
      { jobId, fundedSeconds: renewal.fundedSeconds, totalU: renewal.totalU, totalWei: renewal.totalWei, createdAt: new Date().toISOString() },
    ];
    task.renewalJobId = jobId;
    task.pendingRenewal = null;
    await putTask(task);
    return { jobId, provider, token };
  }
  task.jobId = jobId;
  task.status = 'funding';
  await putTask(task);
  return { jobId, provider, token };
}

function acceptedReply(task: StoredTask, buyer: string, jobId: string, provider: string, token: string) {
  const renewal = task.renewalJobs?.find((r) => r.jobId === jobId);
  if (renewal) {
    return agentText(
      task.taskId,
      task.contextId,
      `Extension accepted. Escrow job ${jobId} created (provider ${provider}). Fund ${renewal.totalU} U ` +
        `of ${token} via fund(${jobId}, ${renewal.totalWei}) from ${buyer} — the rental clock extends once FUNDED is observed on-chain.`,
      [{ artifactId: randomUUID(), name: 'escrow', parts: [{ kind: 'data', data: { jobId, priceWei: renewal.totalWei, token, provider, renewal: true } }] }],
    );
  }
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
  // Idempotent renewal replay: a gateway timeout after job creation must not
  // mint a second renewal job — the buyer gets the existing one back.
  if (task.renewalJobId && task.buyer && task.buyer.toLowerCase() === buyer) {
    const rec = task.renewalJobs?.find((r) => r.jobId === task.renewalJobId);
    if (rec) {
      let provider = '';
      let token = '';
      try {
        const esc = await getEscrow();
        provider = esc.provider;
        token = await esc.client.paymentToken();
      } catch {
        // read-only fallback still returns the job id
      }
      return rpc(id, acceptedReply(task, buyer, task.renewalJobId, provider, token));
    }
  }
  const blocked = await checkGates(task, buyer);
  // Idempotent retry: a gateway timeout after job creation must not mint a
  // second job — the same buyer re-accepting gets the existing one. Checked
  // after gates so genuinely blocked tasks (wrong buyer, no quote) still fail.
  // Funding-state tasks hit the gate above ("is funding"), so re-check here:
  // same buyer + existing job = safe replay of the accept response.
  if (blocked && !(task.jobId && task.buyer && task.buyer.toLowerCase() === buyer.toLowerCase())) {
    return rpcError(id, -32602, blocked);
  }
  // Renewals always mint a fresh escrow job via finishAccept below — never
  // answer them with the main jobId (that orphans the renewal and leaves
  // pendingRenewal dangling).
  if (task.jobId && !task.pendingRenewal && task.buyer && task.buyer.toLowerCase() === buyer.toLowerCase()) {
    let provider = '';
    let token = '';
    try {
      const esc = await getEscrow();
      provider = esc.provider;
      token = await esc.client.paymentToken();
    } catch {
      // Read-only fallback below still returns the job id.
    }
    return rpc(id, acceptedReply(task, buyer, task.jobId, provider, token));
  }
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
