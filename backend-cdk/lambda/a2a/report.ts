import { randomUUID } from 'node:crypto';
import { JobStatus } from '@bnbagent/sdk';
import { verifyBinding } from './accept';
import { getEscrow } from './clients';
import { getTask, putTask } from './store';
import { agentText, rpc, rpcError } from './rpc';

/** crew-report-job: buyer anchored the escrow job from their wallet — record
 * it after onchain validation (client == buyer, provider == ours,
 * budget covered, job OPEN or already FUNDED). */
export async function handleReportJob(id: unknown, data: any) {
  const taskId = String(data.task_id ?? '');
  const jobId = String(data.job_id ?? '');
  if (!taskId || !jobId) return rpcError(id, -32602, 'crew-report-job needs { task_id, job_id }');
  const task = await getTask(taskId);
  if (!task) return rpc(id, agentText('missing', randomUUID(), `No task ${taskId} on this team.`));
  let buyer: string;
  try {
    buyer = (await verifyBinding(data)).toLowerCase();
  } catch (e) {
    return rpcError(id, -32602, e instanceof Error ? e.message : 'binding failed');
  }
  if (!task.buyer || task.buyer.toLowerCase() !== buyer) {
    return rpcError(id, -32602, 'task is bound to a different buyer wallet');
  }
  const renewing = !!task.pendingRenewal;
  const expectedWei = renewing ? task.pendingRenewal!.totalWei : task.quote?.totalWei;
  if (!expectedWei) return rpcError(id, -32602, 'task has nothing to fund — negotiate first');
  let provider = '';
  let job: any;
  try {
    const esc = await getEscrow();
    provider = esc.provider;
    job = await esc.client.getJob(BigInt(jobId));
  } catch (e) {
    return rpcError(id, -32603, `job read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const status = Number(job.status ?? job[0]);
  if (status !== JobStatus.OPEN && status !== JobStatus.FUNDED) {
    return rpcError(id, -32602, `job ${jobId} is not fundable (status ${status})`);
  }
  const client = String(job.client ?? job[1] ?? '').toLowerCase();
  if (client !== buyer) {
    return rpcError(id, -32602, `job ${jobId} belongs to ${client} — anchor from the bound buyer wallet`);
  }
  const jobProvider = String(job.provider ?? job[2] ?? '').toLowerCase();
  if (jobProvider !== provider.toLowerCase()) {
    return rpcError(id, -32602, `job ${jobId} names a different provider — use the quoted params`);
  }
  const budget = BigInt(job.budget ?? job[4] ?? 0);
  if (budget < BigInt(expectedWei)) {
    return rpcError(id, -32602, `job ${jobId} budget ${budget} below quoted ${expectedWei}`);
  }
  if (renewing) {
    const r = task.pendingRenewal!;
    task.renewalJobs = [
      ...(task.renewalJobs ?? []),
      { jobId, fundedSeconds: r.fundedSeconds, totalU: r.totalU, totalWei: r.totalWei, createdAt: new Date().toISOString() },
    ];
    task.renewalJobId = jobId;
    task.pendingRenewal = null;
    task.jobParams = null;
    await putTask(task);
  } else {
    task.jobId = jobId;
    task.jobParams = null;
    await putTask(task);
  }
  return rpc(
    id,
    agentText(
      task.taskId,
      task.contextId,
      `Job ${jobId} recorded${renewing ? ' (extension)' : ''} — buyer ${buyer}, budget ${expectedWei}. ` +
        `Poll web3-task-status: the ${renewing ? 'clock extends' : 'task flips to WORKING'} once FUNDED is observed on-chain.`,
      [{ artifactId: randomUUID(), name: 'escrow', parts: [{ kind: 'data', data: { jobId, renewal: renewing } }] }],
    ),
  );
}
