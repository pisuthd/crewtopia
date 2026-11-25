import { randomUUID } from 'node:crypto';
import { JobStatus } from '@bnbagent/sdk';
import { bootCrewSandbox, getEscrow } from './clients';
import { maybeSupervise } from './crewCheck';
import { getTask, putTask, touchTask, tryFlipToWorking } from './store';
import { agentText, rpc, rpcError } from './rpc';

export async function handleStatus(id: unknown, data: any) {
  const taskId = String(data.task_id ?? '');
  if (!taskId) return rpcError(id, -32602, 'web3-task-status needs a task_id');
  let task = await getTask(taskId);
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
          // Crew boots in the renter's wallet sandbox (no task VM): ensure it
          // is live, then start the crew session there. Fire-and-forget; the
          // rental clock gates chat until funded time runs out.
          // Intent stamp: history treats a recent launch as started so the
          // chat greeting doesn't duplicate the in-flight kickoff.
          await touchTask(taskId, { crewStartingAt: new Date().toISOString() }).catch(() => {});
          const bootNote = flipped.buyer ? await bootCrewSandbox(flipped.buyer, taskId) : 'no buyer bound — crew not started.';
          chainNote = ` on-chain=FUNDED — task is now WORKING. ${bootNote}`;
        }
      }
    } catch (e) {
      chainNote = ` chain check failed: ${e instanceof Error ? e.message : String(e)}.`;
    }
  }
  // Lazy top-up credit: a funded renewal job extends the same rental's
  // clock (elapsed keeps accruing from workingSince — time stacks).
  if (task.renewalJobId && task.status === 'working') {
    const renewalId: string = task.renewalJobId;
    try {
      const { client: escrow } = await getEscrow();
      const rjob = await escrow.getJob(BigInt(renewalId));
      if (Number(rjob.status) === JobStatus.FUNDED) {
        const fresh = await getTask(taskId);
        const rec = fresh?.renewalJobs?.find((r) => r.jobId === renewalId);
        if (fresh && fresh.renewalJobId === renewalId && rec && fresh.quote) {
          // Fix D: atomic conditional credit — the old read-modify-write
          // double-credited when two polls raced. Only the first wins.
          const { creditRenewal } = await import('./store');
          if (await creditRenewal(taskId, renewalId, rec.fundedSeconds)) {
            task = { ...fresh, quote: { ...fresh.quote, fundedSeconds: fresh.quote.fundedSeconds + rec.fundedSeconds }, renewalJobId: null };
            chainNote += ` extension credited (+${Math.round(rec.fundedSeconds / 60)} min).`;
          }
        }
      }
    } catch (e) {
      chainNote += ` top-up check failed: ${e instanceof Error ? e.message : String(e)}.`;
    }
  }
  // Rental clock: how much of the funded window is used vs left.
  // Elapsed accrues only while WORKING (clock starts at workingSince, stops
  // at endedAt). Pre-fund and ended rentals report the full/zero remainder.
  const funded = task.quote?.fundedSeconds ?? 0;
  const sinceMs = task.workingSince ? Date.parse(task.workingSince) : NaN;
  const ended = task.status === 'ended' || !!task.endedAt;
  const elapsed = !ended && task.status === 'working' && Number.isFinite(sinceMs)
    ? Math.max(0, Math.floor((Date.now() - sinceMs) / 1000))
    : 0;
  const left = ended ? 0 : Math.max(0, funded - elapsed);
  const clockText = `clock=${elapsed}s elapsed / ${left}s left of ${funded}s funded (~${Math.round(left / 60)} min left)` +
    (ended ? ' [rental ended]' : '');
  const clockData = {
    status: task.status,
    fundedSeconds: funded,
    elapsedSeconds: elapsed,
    secondsLeft: left,
    minutesLeft: Math.round(left / 60),
    workingSince: task.workingSince ?? null,
    endedAt: task.endedAt ?? null,
    jobId: task.jobId,
  };
  // Lazy crew supervision (buyer-driven, zero idle cost): ensure-started,
  // hard-stop watch, stall nudge (max 3), dev preview liveness.
  const crewNotes = await maybeSupervise(task).catch(() => [] as string[]);
  const crewLine = crewNotes.length > 0 ? ` Crew: ${crewNotes.join(' · ')}.` : '';
  return rpc(
    id,
    agentText(
      task.taskId,
      task.contextId,
      `Task ${task.taskId}: status=${task.status}, buyer=${task.buyer ?? 'unbound (browsing)'}, ` +
        `rental=${task.quote?.totalU ?? '?'} U for ${task.quote?.chunks ?? '?'} chunk(s), ` +
        `job=${task.jobId ?? 'none'}, approved=${task.approvedAt ?? 'no'}.${chainNote} created=${task.createdAt}. ` +
        clockText + crewLine,
      [{ artifactId: randomUUID(), name: 'rental-clock', parts: [{ kind: 'data', data: clockData }] }],
    ),
  );
}
