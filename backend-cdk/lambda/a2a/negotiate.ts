import { randomUUID } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { buildQuote } from '../pricelist';
import type { TeamDef } from '../pricelist';
import { resolveTeamFor, rosterFor } from '../teamStore';
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
  // Multi-team: wire `teamId` (static registry or owner-scoped custom team).
  // Unknown ids fail fast; not-yet-rentable teams (studio) fail with status.
  // Custom teams need a bound wallet — the owner must match the creator.
  let team: TeamDef;
  try {
    team = await resolveTeamFor((data as any).teamId, buyer);
  } catch (e) {
    return rpcError(id, -32602, e instanceof Error ? e.message : 'unknown team');
  }
  if (team.status !== 'available') {
    return rpcError(id, -32602, `team '${team.id}' is not rentable yet (${team.status})`);
  }
  const brief = String(data.brief ?? '');
  const budgetU = (data as any).budgetU;
  // Explicit rental minutes (app-confirmed). Falls back to parsing the
  // brief text, else one chunk — wire behavior unchanged.
  const minutesRaw = Number((data as any).minutes);
  const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? minutesRaw : undefined;
  const contextId = message.contextId ?? randomUUID();
  let task: StoredTask | null = null;
  if (message.contextId) {
    task = await findSubmittedByContext(contextId);
  }
  if (!task) {
    const quote = buildQuote(brief, budgetU, minutes, team);
    const newTaskId = randomUUID();
    task = {
      taskId: newTaskId,
      contextId,
      skill: data.skill,
      teamId: team.id,
      roster: await rosterFor(team.id, buyer, newTaskId),
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
  let taskTeam: TeamDef;
  try {
    taskTeam = await resolveTeamFor(task.teamId, task.buyer ?? buyer);
  } catch (e) {
    return rpcError(id, -32602, e instanceof Error ? e.message : 'unknown team');
  }
  if (!task.quote) {
    task.quote = buildQuote(task.brief, budgetU, minutes, taskTeam);
    task.minutesSource = task.quote.minutesSource;
  }
  task.messages = [...(task.messages ?? []), { role: 'user' as const, text: brief }].slice(-20);
  const quote = task.quote;
  const lineTeam = taskTeam;
  // Brain first, template fallback: the reply is conversational, the quote
  // envelope stays pricelist-computed (model proposes prose, never prices).
  const brain = await modelReply(task.messages, quote);
  const rentLine = `rents the whole ${lineTeam.display} for ~${Math.round(quote.fundedSeconds / 60)} min ` +
    `(${quote.chunks} × 6-min chunk) at ${quote.rateUPerHour} U/hr`;
  const bindHint = task.buyer
    ? `buyer bound: ${task.buyer}.`
    : `unbound browsing task. To bind: sign "${bindMessage('<your wallet>', '<any unique nonce>')}" with your wallet and re-send with { buyerAddress, nonce, buyerSig }.`;
  const text = brain
    ? `${brain}\n\n— rental quote: ${quote.totalU} U total (${rentLine}, escrow ${quote.escrow.standard}). ${bindHint} ` +
      `Track with web3-task-status + task_id ${task.taskId}.`
    : `${quote.displayName} rental quote for "${task.brief.slice(0, 120)}":\n${rentLine}\nTotal: ${quote.totalU} U (escrow ${quote.escrow.standard}, ${quote.escrow.disputeWindowS}s dispute window). ${bindHint} ` +
      `Top up live rentals with crew-extend, end early with crew-end. ` +
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
