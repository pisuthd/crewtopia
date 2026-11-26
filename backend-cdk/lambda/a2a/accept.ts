import { randomUUID } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { escrowAddrs } from './clients';
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

/** Buyer-created job params (no chain writes). The buyer anchors the ERC-8183
 * job from their own wallet — client is always msg.sender, so only the buyer
 * can create + fund. Server never holds buyer funds. */
export interface JobParams {
  commerce: string;
  router: string;
  policy: string;
  provider: string;
  evaluator: string;
  hook: string;
  expiredAt: string;
  description: string;
  totalWei: string;
  totalU: string;
  token: string;
  renewal: boolean;
}

export async function buildJobParams(task: StoredTask, buyer: string): Promise<JobParams> {
  const renewal = task.pendingRenewal;
  const fundedSeconds = renewal ? renewal.fundedSeconds : task.quote!.fundedSeconds;
  const totalWei = renewal ? renewal.totalWei : task.quote!.totalWei;
  const totalU = renewal ? renewal.totalU : task.quote!.totalU;
  // Rental expiry: funded window + 1h grace for submit/settle. Unused
  // escrow returns via claimRefund after expiry; buyers chain sessions
  // via contextId rather than one long job.
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + fundedSeconds + 3600);
  const description = renewal
    ? JSON.stringify({ taskId: task.taskId, renewal: true, chunks: renewal.chunks, totalU: renewal.totalU, buyer })
    : JSON.stringify({ taskId: task.taskId, brief: task.brief.slice(0, 280), team: task.quote!.team, chunks: task.quote!.chunks, totalU: task.quote!.totalU, buyer });
  const { commerce, router, policy, provider, token } = await escrowAddrs();
  task.buyer = buyer.toLowerCase();
  // Fresh hires wait on funding; renewals keep the live clock (the new job
  // is reported separately and credited on FUNDED).
  if (!renewal) task.status = 'funding';
  task.jobParams = { provider, expiredAt: expiredAt.toString(), description, totalWei, renewal: !!renewal };
  await putTask(task);
  return {
    commerce, router, policy, provider,
    evaluator: router, hook: router,
    expiredAt: expiredAt.toString(), description, totalWei, totalU, token,
    renewal: !!renewal,
  };
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

/** Reply carrying buyer-side job params (no jobId yet — buyer anchors first). */
function paramsReply(task: StoredTask, buyer: string, p: JobParams) {
  const totalU = p.totalU;
  const noun = p.renewal ? 'Extension accepted' : 'Quote accepted';
  return agentText(
    task.taskId,
    task.contextId,
    `${noun}. Anchor the escrow job from YOUR wallet (you become the job client — only you can fund it): ` +
      `createJob(provider ${p.provider}, evaluator ${p.evaluator}, expiredAt ${p.expiredAt}, description, hook ${p.hook}) on commerce ${p.commerce}, ` +
      `then registerJob(jobId, ${p.policy}) on router ${p.router}, setBudget(jobId, ${p.totalWei}), approve ${p.totalU} U, fund(jobId, ${p.totalWei}). ` +
      `Then report via crew-report-job { task_id, job_id } and poll web3-task-status — the task flips to WORKING once FUNDED is observed on-chain.`,
    [{ artifactId: randomUUID(), name: 'escrow', parts: [{ kind: 'data', data: { ...p, buyer } }] }],
  );
}

export async function handleAccept(id: unknown, data: any) {
  // Buyer accepts the quoted total. Buyer anchors the ERC-8183 job from
  // their own wallet (create/register/setBudget) and funds it; server only
  // quotes + verifies. Status flips to WORKING once FUNDED is observed
  // (lazy, on status poll).
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
  // Idempotent renewal replay: params already issued and job reported — the
  // buyer gets the existing job back.
  if (task.renewalJobId && task.buyer && task.buyer.toLowerCase() === buyer) {
    const rec = task.renewalJobs?.find((r) => r.jobId === task.renewalJobId);
    if (rec) {
      let provider = '';
      let token = '';
      try {
        const esc = await escrowAddrs();
        provider = esc.provider;
        token = esc.token;
      } catch {
        // read-only fallback still returns the job id
      }
      return rpc(id, acceptedReply(task, buyer, task.renewalJobId, provider, token));
    }
  }
  const blocked = await checkGates(task, buyer);
  // Params issued but job not yet anchored (buyer anchors async) — the same
  // buyer re-accepting gets fresh params. Abandoned OPEN jobs hold no funds.
  if (blocked && task.buyer?.toLowerCase() === buyer && task.quote) {
    const freshAwaiting = !task.pendingRenewal && !task.jobId && task.status === 'funding' && task.jobParams;
    const renewalAwaiting = !!task.pendingRenewal && !task.renewalJobId;
    if (freshAwaiting || renewalAwaiting) {
      try {
        const params = await buildJobParams(task, buyer);
        return rpc(id, paramsReply(task, buyer, params));
      } catch (e) {
        return rpcError(id, -32603, `escrow setup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return rpcError(id, -32602, blocked);
  }
  if (blocked) {
    return rpcError(id, -32602, blocked);
  }
  // Renewals mint a fresh buyer-side job per report below — never answer
  // them with the main jobId (that orphans the renewal and leaves
  // pendingRenewal dangling).
  if (task.jobId && !task.pendingRenewal && task.buyer && task.buyer.toLowerCase() === buyer.toLowerCase()) {
    let provider = '';
    let token = '';
    try {
      const esc = await escrowAddrs();
      provider = esc.provider;
      token = esc.token;
    } catch {
      // Read-only fallback below still returns the job id.
    }
    return rpc(id, acceptedReply(task, buyer, task.jobId, provider, token));
  }
  try {
    const params = await buildJobParams(task, buyer);
    return rpc(id, paramsReply(task, buyer, params));
  } catch (e) {
    return rpcError(id, -32603, `escrow setup failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Async finish for the app flow: chain work without the 29s gateway clock.
 * Buyer-side anchoring needs no server chain calls — report the job id. */
export async function handleAcceptFinish(taskId: string): Promise<{ jobId: string } | { error: string }> {
  const task = await getTask(taskId);
  if (!task || !task.quote) return { error: `no quotable task ${taskId}` };
  if (task.jobId) return { jobId: task.jobId };
  return { error: 'no job reported yet — anchor from your wallet, then crew-report-job' };
}
