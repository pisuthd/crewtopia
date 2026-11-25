import { randomUUID } from 'node:crypto';
import { recoverMessageAddress, keccak256, stringToHex } from 'viem';
import { JobStatus } from '@bnbagent/sdk';
import { getEscrow } from './clients';
import { getTask, putTask } from './store';
import { deliveryExists, mintDeliveryGetUrl } from '../sandbox';
import { checkDevServer, terminateVm } from './vm';
import { approveMessage, deliverMessage } from './messages';
import { agentText, receiptUrl, rpc, rpcError } from './rpc';

export async function handleDeliver(id: unknown, data: any) {
  // Team-operator delivery: { task_id, action: submit|settle, providerAddress,
  // nonce, providerSig } over deliverMessage(). Submit pins the receipt URL
  // on-chain; settle releases escrow after the window OR with buyer approval
  // ({ buyerSig } over approveMessage()).
  const taskId = String(data.task_id ?? '');
  const action = String(data.action ?? '');
  if (!taskId || (action !== 'submit' && action !== 'settle')) {
    return rpcError(id, -32602, 'web3-deliver needs { task_id, action: submit|settle }');
  }
  const task = await getTask(taskId);
  if (!task || !task.jobId) {
    return rpc(id, agentText('missing', randomUUID(), `No funded task ${taskId}. Accept a quote first.`));
  }
  try {
    const { client: escrow, provider } = await getEscrow();
    const signer = await recoverMessageAddress({
      message: deliverMessage(taskId, action, String(data.nonce ?? '')),
      signature: data.providerSig as `0x${string}`,
    });
    if (!data.providerAddress || signer.toLowerCase() !== String(data.providerAddress).toLowerCase() || signer.toLowerCase() !== provider.toLowerCase()) {
      return rpcError(id, -32602, 'providerSig must be the team provider wallet');
    }
    const jobId = BigInt(task.jobId);
    // Renewal top-ups are separate escrow jobs on the same task — submit and
    // settle every job so no buyer funds stay locked. Per-job expiry means
    // each is independently refundable; settling together keeps one receipt.
    const allJobIds = [jobId, ...(task.renewalJobs ?? []).map((r) => BigInt(r.jobId))];

    if (action === 'submit') {
      // Chain is source of truth: a submit tx that landed while the handler
      // errored leaves task=working but job=SUBMITTED. Sync, don't resubmit.
      const pre = await escrow.getJob(jobId);
      if (Number(pre.status) === JobStatus.SUBMITTED || Number(pre.status) === JobStatus.COMPLETED) {
        task.status = Number(pre.status) === JobStatus.COMPLETED ? 'completed' : 'submitted';
        task.deliverable = task.deliverable ?? { hash: String(pre.deliverable ?? ''), url: receiptUrl(taskId), submittedAt: new Date(Number(pre.submittedAt) * 1000).toISOString(), health: 'synced: submit landed earlier' };
        const vmNote = Number(pre.status) === JobStatus.COMPLETED ? await terminateVm(task) : '';
        await putTask(task);
        return rpc(id, agentText(task.taskId, task.contextId,
          `Already ${Number(pre.status) === JobStatus.COMPLETED ? 'COMPLETED' : 'SUBMITTED'} on-chain (submit landed earlier). Task synced. ${vmNote} Receipt: ${receiptUrl(taskId)}.`));
      }
      if (task.status !== 'working') {
        return rpcError(id, -32602, `Task ${taskId} is ${task.status} — only working tasks can be submitted`);
      }
      // Health gate: dev server must answer before anything pins on-chain.
      let health: string;
      try {
        health = await checkDevServer(task);
      } catch (e) {
        return rpcError(id, -32602, `health gate refused submit: ${e instanceof Error ? e.message : String(e)}`);
      }
      // Delivery gate: the crew must upload the source zip first (deliver tool
      // → presigned PUT). Buyers download via presigned GET (private bucket).
      let downloadUrl: string;
      try {
        if (!(await deliveryExists(taskId))) {
          return rpcError(id, -32602, 'no delivery uploaded yet — have the crew run the deliver tool, then submit');
        }
        downloadUrl = await mintDeliveryGetUrl(taskId);
      } catch (e) {
        return rpcError(id, -32603, `delivery link failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      const descriptor = JSON.stringify({
        taskId, brief: task.brief, quote: task.quote, buyer: task.buyer,
        receipt: receiptUrl(taskId),
        health,
        note: 'Dry-run deliverable: quote fulfillment transcript.',
      });
      const hash = keccak256(stringToHex(descriptor));
      const submitted = await escrow.submit(jobId, hash, { deliverable_url: receiptUrl(taskId) });
      const job = await escrow.getJob(jobId);
      task.status = 'submitted';
      task.deliverable = { hash, url: receiptUrl(taskId), downloadUrl, submittedAt: new Date(Number(job.submittedAt) * 1000).toISOString(), health };
      // Renewal jobs carry the same deliverable so they settle together.
      const renewalNotes: string[] = [];
      for (const r of task.renewalJobs ?? []) {
        try {
          const rj = await escrow.getJob(BigInt(r.jobId));
          const st = Number(rj.status);
          if (st === JobStatus.SUBMITTED || st === JobStatus.COMPLETED) {
            renewalNotes.push(`renewal ${r.jobId}: already ${st === JobStatus.COMPLETED ? 'COMPLETED' : 'SUBMITTED'}`);
            continue;
          }
          await escrow.submit(BigInt(r.jobId), hash, { deliverable_url: receiptUrl(taskId) });
          renewalNotes.push(`renewal ${r.jobId}: submitted`);
        } catch (e) {
          renewalNotes.push(`renewal ${r.jobId}: submit failed (${e instanceof Error ? e.message : String(e)}) — settle will retry it`);
        }
      }
      await putTask(task);
      return rpc(id, agentText(task.taskId, task.contextId,
        `Delivered. submit → ${submitted.transactionHash ?? 'ok'}. Receipt: ${receiptUrl(taskId)}. ` +
          `Source zip (7-day link): ${downloadUrl} ` +
          `Settle unlocks after the dispute window — send buyerSig over "${approveMessage(taskId)}" any time to pre-authorize it.`,
        [{ artifactId: randomUUID(), name: 'delivery', parts: [{ kind: 'data', data: { downloadUrl } }] }]));
    }

    // settle — chain is source of truth: sync from any task state.
    // Already settled out-of-band (settle is permissionless): sync and stop.
    // Buyer approval is recorded intent (authorizes the operator to settle
    // when eligible). It can NEVER bypass the OptimisticPolicy window —
    // silence-approves means the chain decides, not us.
    if (data.buyerSig) {
      try {
        const approver = await recoverMessageAddress({ message: approveMessage(taskId), signature: data.buyerSig as `0x${string}` });
        if (!task.buyer || approver.toLowerCase() !== task.buyer.toLowerCase()) {
          return rpcError(id, -32602, 'buyerSig must be the bound buyer');
        }
        task.approvedAt = new Date().toISOString();
        await putTask(task);
      } catch {
        return rpcError(id, -32602, 'buyerSig is not a valid approval signature');
      }
    }
    const job = await escrow.getJob(jobId);
    // Already settled out-of-band (settle is permissionless): sync and stop.
    // All jobs (main + renewals) must read COMPLETED before the task does.
    const states = await Promise.all(
      allJobIds.map(async (j) => {
        try {
          return Number((await escrow.getJob(j)).status);
        } catch {
          return -1;
        }
      }),
    );
    if (states.every((s) => s === JobStatus.COMPLETED)) {
      task.status = 'completed';
      const vmNote = await terminateVm(task);
      await putTask(task);
      return rpc(id, agentText(task.taskId, task.contextId,
        `Already COMPLETED on-chain (settled out-of-band). Task synced to completed. ${vmNote}. Receipt: ${receiptUrl(taskId)}.`));
    }
    const window = await escrow.policy.disputeWindow();
    // Eligibility is per-job (each submit has its own submittedAt): wait for
    // the latest window, then settle every unsettled job.
    const submittedAts = await Promise.all(
      allJobIds.map(async (j) => {
        try {
          return Number((await escrow.getJob(j)).submittedAt);
        } catch {
          return 0;
        }
      }),
    );
    const submittedAt = Number(job.submittedAt);
    // Stale RPC right after submit can read submittedAt=0 — never treat that
    // as eligible (it would fire a doomed settle → NotDecided). Tell the
    // buyer to wait out the window instead.
    if (!submittedAt || submittedAts.some((s) => !s)) {
      return rpc(id, agentText(task.taskId, task.contextId,
        `Not yet. Submit just landed and the chain read is still syncing — dispute window is ~15 min from submit. ` +
          (task.approvedAt ? `Buyer approval recorded at ${task.approvedAt} — settle will go through on the next deliver/settle call after the window.` : `Send buyerSig over "${approveMessage(taskId)}" to pre-authorize settlement.`)));
    }
    const eligibleAt = Math.max(...submittedAts) + Number(window);
    const now = Math.floor(Date.now() / 1000);
    if (now < eligibleAt) {
      const waitMin = Math.ceil((eligibleAt - now) / 60);
      return rpc(id, agentText(task.taskId, task.contextId,
        `Not yet. Dispute window closes ${new Date(eligibleAt * 1000).toISOString()} (~${waitMin} min). ` +
          (task.approvedAt ? `Buyer approval recorded at ${task.approvedAt} — settle will go through on the next deliver/settle call after the window.` : `Send buyerSig over "${approveMessage(taskId)}" to pre-authorize settlement.`)));
    }
    const settledNotes: string[] = [];
    for (const j of allJobIds) {
      try {
        const st = Number((await escrow.getJob(j)).status);
        if (st === JobStatus.COMPLETED) {
          settledNotes.push(`${j}: already COMPLETED`);
          continue;
        }
        const s = await escrow.settle(j);
        settledNotes.push(`${j}: settled → ${s.transactionHash ?? 'ok'}`);
      } catch (e) {
        settledNotes.push(`${j}: settle failed (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    const refreshed = await Promise.all(
      allJobIds.map(async (j) => {
        try {
          return Number((await escrow.getJob(j)).status);
        } catch {
          return -1;
        }
      }),
    );
    const allDone = refreshed.every((s) => s === JobStatus.COMPLETED);
    task.status = allDone ? 'completed' : 'submitted';
    const vmNote = allDone ? await terminateVm(task) : '';
    await putTask(task);
    return rpc(id, agentText(task.taskId, task.contextId,
      `${settledNotes.join(' · ')}. ${allDone ? `Escrow released, task COMPLETED. ${vmNote}.` : 'Some jobs did not settle — retry settle after the window.'} Receipt: ${receiptUrl(taskId)}.`));
  } catch (e) {
    return rpcError(id, -32603, `delivery failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
