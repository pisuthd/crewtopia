import { randomUUID } from 'node:crypto';
import { JobStatus } from '@bnbagent/sdk';
import { autoBoot, getEscrow } from './clients';
import { getTask, tryFlipToWorking } from './store';
import { appendMessages } from '../ember/store';
import { agentText, rpc, rpcError } from './rpc';

export async function handleStatus(id: unknown, data: any) {
  const taskId = String(data.task_id ?? '');
  if (!taskId) return rpcError(id, -32602, 'web3-task-status needs a task_id');
  const task = await getTask(taskId);
  if (!task) {
    return rpc(id, agentText('missing', randomUUID(), `No task ${taskId} on this team. Check the id and try again.`));
  }
  // Lazy fund verification: awaiting funds → check the chain, flip to WORKING.
  let chainNote = '';
  if (task.jobId && task.status === 'funding') {
    try {
      const { client: escrow } = await getEscrow();
      const job = await escrow.getJob(BigInt(task.jobId));
      const chainStatus = JobStatus[Number(job.status)] ?? String(job.status);
      chainNote = ` on-chain=${chainStatus}.`;
      if (Number(job.status) === JobStatus.FUNDED) {
        // Atomic flip — overlapping polls race here; only the winner boots
        // the sandbox and announces. Losers report the settled state.
        const flipped = await tryFlipToWorking(taskId);
        if (!flipped) {
          chainNote = ' on-chain=FUNDED — task is already WORKING.';
        } else {
          const bootNote = await autoBoot(taskId);
          chainNote = ` on-chain=FUNDED — task is now WORKING. ${bootNote}`;
          // Receipt in-thread: Ember announces the flip so the chat tells the story.
          if (flipped.viaEmber && flipped.buyer) {
            const mins = Math.round((flipped.quote?.fundedSeconds ?? 0) / 60);
            await appendMessages(flipped.buyer, 'ember', [
              {
                role: 'assistant',
                text: `Funded — ${flipped.quote?.displayName ?? 'Dev Crew'} sandbox is booting now (${mins} min, ${flipped.quote?.totalU ?? '?'} $U escrowed). Chat with the crew to start building, and ask me for the preview link anytime.`,
                at: new Date().toISOString(),
              },
            ]).catch(() => {});
          }
        }
      }
    } catch (e) {
      chainNote = ` chain check failed: ${e instanceof Error ? e.message : String(e)}.`;
    }
  }
  return rpc(
    id,
    agentText(
      task.taskId,
      task.contextId,
      `Task ${task.taskId}: status=${task.status}, buyer=${task.buyer ?? 'unbound (browsing)'}, ` +
        `rental=${task.quote?.totalU ?? '?'} U for ${task.quote?.chunks ?? '?'} chunk(s), ` +
        `job=${task.jobId ?? 'none'}, approved=${task.approvedAt ?? 'no'}.${chainNote} created=${task.createdAt}.`,
    ),
  );
}
