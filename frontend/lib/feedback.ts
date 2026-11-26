'use client';

import { keccak256, stringToHex, type WalletClient } from 'viem';

/** Onchain agent per rentable static crew. Custom teams share Dev's agent —
 * their ratings would misattribute, so the UI only offers feedback for these. */
export const TEAM_AGENT_ID: Record<string, number> = {
  'dev-crew': 2919,
  'voice-crew': 2920,
  // Agent-name aliases (old tasks + crewTeamId fallback use these).
  'crewtopia-dev-crew': 2919,
  'crewtopia-voice-crew': 2920,
};

export const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const;

const GIVE_FEEDBACK_ABI = [
  {
    name: 'giveFeedback',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

const GET_SUMMARY_ABI = [
  {
    name: 'getSummary',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'summaryValue', type: 'int128' },
      { name: 'summaryValueDecimals', type: 'uint8' },
    ],
  },
] as const;

/** Stars (1-5) → registry value on the 100 scale used by the scripts. */
export function starsToValue(stars: number): bigint {
  const s = Math.max(1, Math.min(5, Math.round(stars)));
  return BigInt(s * 20);
}

/** Buyer → Reputation Registry, direct. Reverts for the team owner
 * (protocol self-feedback rule) — callers must map that to plain language. */
export async function leaveFeedback(
  client: WalletClient,
  account: `0x${string}`,
  teamId: string,
  stars: number,
  jobId: string,
): Promise<`0x${string}`> {
  const agentId = TEAM_AGENT_ID[teamId];
  if (!agentId) throw new Error('Only Dev and Voice crews take onchain feedback.');
  const receipt = JSON.stringify({ agentId, jobId, client: account, value: Number(starsToValue(stars)), tag1: 'completed', tag2: 'app-hire', at: new Date().toISOString() });
  return client.writeContract({
    address: REPUTATION_REGISTRY,
    abi: GIVE_FEEDBACK_ABI,
    functionName: 'giveFeedback',
    args: [
      BigInt(agentId),
      starsToValue(stars),
      0,
      'completed',
      'app-hire',
      `https://h9907ecjy9.execute-api.ap-southeast-1.amazonaws.com/prod/.well-known/teams/${teamId}/agent-card.json`,
      '',
      keccak256(stringToHex(receipt)),
    ],
    chain: client.chain,
    account,
  });
}

export function isSelfFeedbackError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /self-feedback|own crew|not allowed/i.test(m);
}

/** Pending post-rental rating (set at end-rental, cleared on submit/skip). */
const PENDING_KEY = 'crewtopia-pending-feedback';

export interface PendingFeedback {
  taskId: string;
  teamId: string;
  at: string;
}

export function loadPendingFeedback(): PendingFeedback | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingFeedback;
    if (!p.taskId || !TEAM_AGENT_ID[p.teamId]) return null;
    return p;
  } catch {
    return null;
  }
}

export function savePendingFeedback(taskId: string, teamId: string): void {
  try {
    if (!TEAM_AGENT_ID[teamId]) return; // customs don't take onchain feedback
    localStorage.setItem(PENDING_KEY, JSON.stringify({ taskId, teamId, at: new Date().toISOString() }));
  } catch { /* private mode — rating prompt just won't persist */ }
}

export function clearPendingFeedback(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch { /* noop */ }
}

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') ?? '';

export interface FeedbackTally {
  teamId: string;
  count: number;
  avg: number;
  ratings: Array<{ stars: number; tx: string; at: string }>;
}

/** Record an app-submitted rating in the readable tally (chain stays source). */
export async function submitFeedbackTally(
  token: string,
  taskId: string,
  tx: string,
  stars: number,
): Promise<void> {
  const res = await fetch(`${API}/rent/io/teams/feedback`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ taskId, tx, stars }),
  });
  if (!res.ok) throw new Error('tally save failed');
}

/** Public tally for landing display. */
export async function getFeedbackTally(teamId: string): Promise<FeedbackTally | null> {
  try {
    const res = await fetch(`${API}/rent/io/teams/feedback?teamId=${encodeURIComponent(teamId)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as FeedbackTally;
  } catch {
    return null;
  }
}

export { GET_SUMMARY_ABI };
