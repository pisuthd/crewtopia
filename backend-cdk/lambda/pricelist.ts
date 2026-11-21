// Rental pricelist for the Crewtopia Dev Crew (testnet U).
// Flat rate: 0.01 U/hour for the WHOLE team (PM · UX/UI · Frontend · Backend).
// Billed in 6-minute chunks (0.001 U). On-chain settle pays the full chunk
// budget (no prorated payout exists on receipts), so quotes round requested
// time UP to whole chunks. Sessions chain via A2A contextId (same workspace
// resumed); stop = buyer doesn't renew; unused escrow returns via claimRefund
// after expiry. `budgetU` (buyer max) caps the chunk count.
export const TEAM_ID = 'wayfind-dev-team'; // registered on-chain agent name
export const TEAM_DISPLAY = 'Crewtopia Dev Crew';
export const RATE_U_PER_HOUR = '0.01';
export const CHUNK_SECONDS = 360;
export const CHUNK_WEI = 1_000_000_000_000_000n; // 0.001 U
export const MAX_CHUNKS = 80; // 8h cap per quote; longer work chains sessions

export const TEAM_ROLES = [
  'PM — spec, milestones, acceptance',
  'UX/UI — flows, wireframes, component spec',
  'Frontend — dapp build + preview',
  'Backend — APIs, DB/auth, wiring to contracts & services',
];

export interface Quote {
  team: typeof TEAM_ID;
  displayName: string;
  model: 'rental';
  currency: 'U';
  network: 'bsc-testnet';
  rateUPerHour: string;
  chunkSeconds: number;
  chunkU: string;
  chunks: number;
  fundedSeconds: number;
  totalU: string;
  totalWei: string;
  roles: string[];
  escrow: { standard: 'ERC-8183'; disputeWindowS: 900 };
  signed: false; // wallet-signed envelope lands in Phase 3
  /** How the quoted minutes were set — explicit user-confirmed time vs parsed/default. */
  minutesSource?: 'explicit' | 'parsed' | 'default';
  note: string;
}

const DECIMALS = 18n;
const weiToU = (wei: bigint): string => {
  const whole = wei / 10n ** DECIMALS;
  const frac = (wei % 10n ** DECIMALS).toString().padStart(18, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
};

/** Parse a rental duration out of the brief ("30 min", "2h", "1 hour"). Null = default. */
export function parseMinutes(brief: string): number | null {
  const m = brief.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|h(?:ou)?r?s?)\b/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2].startsWith('min') ? n : n * 60;
}

function parseBudgetU(budgetU: unknown): bigint | null {
  if (budgetU === undefined || budgetU === null || budgetU === '') return null;
  const s = String(budgetU);
  if (!/^\d+(\.\d{1,18})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * 10n ** DECIMALS + BigInt((frac + '0'.repeat(18)).slice(0, 18));
}

/** Rental PM: duration → chunks (rounded up), capped by budgetU and MAX_CHUNKS.
 * minutesOverride wins when given (Ember-confirmed rental time); otherwise the
 * duration is parsed out of the brief text, else one chunk. */
export function buildQuote(brief: string, budgetU?: unknown, minutesOverride?: number): Quote {
  const parsed = parseMinutes(brief);
  const explicit =
    typeof minutesOverride === 'number' && Number.isFinite(minutesOverride) && minutesOverride > 0
      ? minutesOverride
      : undefined;
  const minutes = explicit ?? parsed ?? CHUNK_SECONDS / 60;
  const source: 'explicit' | 'parsed' | 'default' =
    explicit !== undefined ? 'explicit' : parsed !== null ? 'parsed' : 'default';
  let chunks = Math.max(1, Math.ceil((minutes * 60) / CHUNK_SECONDS));
  const cap = parseBudgetU(budgetU);
  if (cap !== null) chunks = Math.min(chunks, Number(cap / CHUNK_WEI));
  chunks = Math.min(Math.max(chunks, 1), MAX_CHUNKS);
  const totalWei = CHUNK_WEI * BigInt(chunks);
  const fundedSeconds = chunks * CHUNK_SECONDS;
  return {
    team: TEAM_ID,
    displayName: TEAM_DISPLAY,
    model: 'rental',
    currency: 'U',
    network: 'bsc-testnet',
    rateUPerHour: RATE_U_PER_HOUR,
    chunkSeconds: CHUNK_SECONDS,
    chunkU: weiToU(CHUNK_WEI),
    chunks,
    fundedSeconds,
    totalU: weiToU(totalWei),
    totalWei: totalWei.toString(),
    roles: TEAM_ROLES,
    escrow: { standard: 'ERC-8183', disputeWindowS: 900 },
    signed: false,
    minutesSource: source,
    note: `Flat rental ${RATE_U_PER_HOUR} U/hr, billed in 6-min chunks. ` +
      `This quote rents the whole team for ~${Math.round(fundedSeconds / 60)} min. ` +
      `Renew with the same contextId to continue; stop by not renewing.`,
  };
}
