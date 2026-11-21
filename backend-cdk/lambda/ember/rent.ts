import { randomUUID } from 'node:crypto';
import { buildQuote } from '../pricelist';
import { putTask } from '../a2a/store';
import type { StoredTask } from '../a2a/types';
import { getTeam } from './teams';

export interface RentQuoteArgs {
  teamId: string;
  /** User-confirmed rental time. Always explicit on this path — never estimated silently. */
  minutes: number;
  brief?: string;
  budgetU?: string;
}

export interface RentQuoteResult {
  taskId: string;
  contextId: string;
  team: string;
  minutes: number;
  chunks: number;
  totalU: string;
  totalWei: string;
  fundedSeconds: number;
}

/**
 * Ember's rent_quote tool: creates a rental task with explicit minutes and
 * returns the quote envelope. Money (accept/fund) only proceeds from here —
 * the accept guard rejects Ember tasks without explicit minutes.
 * The session wallet is recorded as buyer up front (binding sig still
 * required at accept — the A2A wire protocol is unchanged).
 */
export async function rentQuote(args: RentQuoteArgs, ownerAddress: string): Promise<RentQuoteResult> {
  const team = getTeam(args.teamId);
  if (!team || team.status !== 'available') {
    throw new Error(`team '${args.teamId}' is not rentable right now`);
  }
  if (!Number.isFinite(args.minutes) || args.minutes <= 0) {
    throw new Error('minutes must be a positive number — confirm the rental time first');
  }
  const brief = (args.brief ?? '').slice(0, 500);
  const quote = buildQuote(brief, args.budgetU, args.minutes);
  const task: StoredTask = {
    taskId: randomUUID(),
    contextId: randomUUID(),
      skill: 'negotiate-web3-task',
      brief,
      buyer: ownerAddress.toLowerCase(),
    status: 'submitted',
    quote,
    minutesSource: 'explicit',
    viaEmber: true,
    jobId: null,
    deliverable: null,
    approvedAt: null,
    messages: [],
    vm: null,
    createdAt: new Date().toISOString(),
  };
  await putTask(task);
  return {
    taskId: task.taskId,
    contextId: task.contextId,
    team: team.name,
    minutes: Math.round(quote.fundedSeconds / 60),
    chunks: quote.chunks,
    totalU: quote.totalU,
    totalWei: quote.totalWei,
    fundedSeconds: quote.fundedSeconds,
  };
}
