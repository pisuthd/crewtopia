import { randomUUID } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { buildQuote } from '../pricelist';
import { findSubmittedByContext, putTask } from './store';
import { modelReply } from './negotiator';
import { bindMessage } from './messages';
import { agentText, rpc, rpcError } from './rpc';
import type { StoredTask } from './types';

export async function handleNegotiate(id: unknown, message: any, data: any) {
  // Optional buyer binding: { buyerAddress, nonce, buyerSig } where buyerSig
  // is the EIP-191 signature of BIND_MESSAGE(buyerAddress, nonce).
  // Unbound tasks are allowed (browsing), but only a bound wallet's funding
  // flips a task toward WORKING — the escrow funder is the identity.
  // Multi-turn: resending with the same contextId continues the existing
  // submitted task (history preserved, first quote stands).
  let buyer: string | null = null;
  if (data.buyerAddress && data.nonce && data.buyerSig) {
    try {
      const recovered = await recoverMessageAddress({
        message: bindMessage(String(data.buyerAddress), String(data.nonce)),
        signature: data.buyerSig as `0x${string}`,
      });
      if (recovered.toLowerCase() !== String(data.buyerAddress).toLowerCase()) {
        return rpcError(id, -32602, 'buyerSig does not match buyerAddress');
      }
      buyer = recovered.toLowerCase();
    } catch {
      return rpcError(id, -32602, 'buyerSig is not a valid EIP-191 signature');
    }
  }
  const brief = String(data.brief ?? '');
  const budgetU = (data as any).budgetU;
  // Explicit rental minutes (Ember-confirmed). Falls back to parsing the
  // brief text, else one chunk — wire behavior unchanged.
  const minutesRaw = Number((data as any).minutes);
  const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? minutesRaw : undefined;
  const contextId = message.contextId ?? randomUUID();
  let task: StoredTask | null = null;
  if (message.contextId) {
    task = await findSubmittedByContext(contextId);
  }
  if (!task) {
    const quote = buildQuote(brief, budgetU, minutes);
    task = {
      taskId: randomUUID(),
      contextId,
      skill: data.skill,
      brief,
      buyer,
      status: 'submitted',
      quote,
      minutesSource: quote.minutesSource,
      jobId: null,
      deliverable: null,
      approvedAt: null,
      messages: [],
      vm: null,
      createdAt: new Date().toISOString(),
    };
  } else if (buyer && !task.buyer) {
    task.buyer = buyer;
  }
  if (!task.quote) {
    task.quote = buildQuote(task.brief, budgetU, minutes);
    task.minutesSource = task.quote.minutesSource;
  }
  task.messages = [...(task.messages ?? []), { role: 'user' as const, text: brief }].slice(-20);
  const quote = task.quote;
  // Brain first, template fallback: the reply is conversational, the quote
  // envelope stays pricelist-computed (model proposes prose, never prices).
  const brain = await modelReply(task.messages, quote);
  const rentLine = `rents the whole Dev Team (PM · UX/UI · Frontend · Backend) for ~${Math.round(quote.fundedSeconds / 60)} min ` +
    `(${quote.chunks} × 6-min chunk) at ${quote.rateUPerHour} U/hr`;
  const bindHint = task.buyer
    ? `buyer bound: ${task.buyer}.`
    : `unbound browsing task. To bind: sign "${bindMessage('<your wallet>', '<any unique nonce>')}" with your wallet and re-send with { buyerAddress, nonce, buyerSig }.`;
  const text = brain
    ? `${brain}\n\n— rental quote: ${quote.totalU} U total (${rentLine}, escrow ${quote.escrow.standard}). ${bindHint} ` +
      `Track with web3-task-status + task_id ${task.taskId}.`
    : `${quote.displayName} rental quote for "${task.brief.slice(0, 120)}":\n${rentLine}\nTotal: ${quote.totalU} U (escrow ${quote.escrow.standard}, ${quote.escrow.disputeWindowS}s dispute window). ${bindHint} ` +
      `Renew with the same contextId to continue; stop by not renewing. ` +
      `Track with web3-task-status + task_id ${task.taskId}.`;
  task.messages = [...task.messages, { role: 'agent' as const, text }].slice(-20);
  await putTask(task);
  return rpc(
    id,
    agentText(
      task.taskId,
      task.contextId,
      text,
      [{ artifactId: randomUUID(), name: 'quote', parts: [{ kind: 'data', data: quote }] }],
    ),
  );
}
