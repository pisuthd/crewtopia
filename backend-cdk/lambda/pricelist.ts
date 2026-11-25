// Rental pricelist for Crewtopia teams (testnet U).
// Flat rate: 0.01 U/hour for the WHOLE team, billed in 6-minute chunks
// (0.001 U). On-chain settle pays the full chunk budget (no prorated payout
// exists on receipts), so quotes round requested time UP to whole chunks.
// Sessions chain via A2A contextId (same workspace resumed); stop = buyer
// doesn't renew; unused escrow returns via claimRefund after expiry.
// `budgetU` (buyer max) caps the chunk count.
//
// Multi-team (option B): one entry per crew. buildQuote takes the team
// explicitly; wire callers pass `teamId` (defaults to dev-crew).
export interface TeamMember {
  role: string;
  name: string;
  title: string;
  focus: string;
}

export interface TeamDef {
  /** Wire id used in `teamId` args and card URLs. */
  id: string;
  /** Registered on-chain agent name (scripts/register-team.ts AGENT_NAME). */
  agentName: string;
  display: string;
  description: string;
  roles: string[];
  /** Short member ids (pm/ux/…) — reserved for the future sandbox-handoff skill. */
  memberRoles: string[];
  /** Named roster surfaced on the agent card (who the team consists of). */
  members: TeamMember[];
  rateUPerHour: string;
  status: 'available' | 'soon';
}

export const DEV_TEAM: TeamDef = {
  id: 'dev-crew',
  agentName: 'crewtopia-dev-crew',
  display: 'Dev Crew',
  description:
    'Full product crew for rent: PM scopes milestones, frontend builds the dapp, backend wires APIs and data.',
  roles: [
    'PM — spec, milestones, acceptance',
    'Frontend — dapp build',
    'Backend — APIs, DB/auth, wiring to contracts & services',
  ],
  memberRoles: ['pm', 'frontend', 'backend'],
  members: [
    { role: 'pm', name: 'Taylor', title: 'Tech Lead', focus: 'Scope, milestones, task splits, acceptance. Message first.' },
    { role: 'frontend', name: 'Reef', title: 'Frontend Developer', focus: 'React/Vite/Tailwind UI, serves the dev preview.' },
    { role: 'backend', name: 'Moss', title: 'Backend Developer', focus: 'APIs, DB/auth, indexing, on-chain wiring.' },
  ],
  rateUPerHour: '0.01',
  status: 'available',
};

export const STUDIO_TEAM: TeamDef = {
  id: 'studio-crew',
  agentName: 'crewtopia-studio-crew',
  display: 'Studio Crew',
  description:
    'Brand-anchored image generation and precise edits. Landing now, rentable soon.',
  roles: ['Creative Director', 'Stylist', 'Generator', 'Retoucher'],
  memberRoles: ['director', 'stylist', 'generator', 'retoucher'],
  members: [
    { role: 'director', name: 'Director', title: 'Creative Director', focus: 'Brief to shot list, style, acceptance. Message first.' },
    { role: 'stylist', name: 'Stylist', title: 'Stylist', focus: 'Style and brand anchors.' },
    { role: 'generator', name: 'Generator', title: 'Generator', focus: 'Text-to-image, batches, anchored series.' },
    { role: 'retoucher', name: 'Retoucher', title: 'Retoucher', focus: 'Precise edits, multi-turn refinement.' },
  ],
  rateUPerHour: '0.01',
  status: 'soon',
};

export const VOICE_TEAM: TeamDef = {
  id: 'voice-crew',
  agentName: 'crewtopia-voice-crew',
  display: 'Voice Crew',
  description:
    'Realtime voice concierge with a backstage crew: Aria talks to you live, Finn looks things up, Dot keeps the records.',
  roles: ['Concierge — live voice', 'Scout — lookup & research', 'Keeper — database & memory'],
  memberRoles: ['concierge', 'scout', 'keeper'],
  members: [
    { role: 'concierge', name: 'Aria', title: 'Concierge', focus: 'Live voice conversation. Greets, listens, answers; pulls Scout/Keeper in via @mentions. Message first.' },
    { role: 'scout', name: 'Finn', title: 'Scout', focus: 'Fast lookup and research for the concierge. Stays backstage unless asked.' },
    { role: 'keeper', name: 'Dot', title: 'Keeper', focus: 'Database, files, and memory. Records what matters, recalls on request.' },
  ],
  rateUPerHour: '0.01',
  status: 'available',
};

export const TEAM_REGISTRY: Record<string, TeamDef> = {
  [DEV_TEAM.id]: DEV_TEAM,
  [STUDIO_TEAM.id]: STUDIO_TEAM,
  [VOICE_TEAM.id]: VOICE_TEAM,
};

/** Wire teamId → TeamDef. Null/undefined/'' = primary team (dev-crew). */
export function resolveTeam(teamId?: unknown): TeamDef {
  if (teamId === undefined || teamId === null || String(teamId) === '') return DEV_TEAM;
  return TEAM_REGISTRY[String(teamId)] ?? DEV_TEAM;
}

// Back-compat single-team exports (dev-crew defaults; teams.ts uses these).
export const TEAM_ID = DEV_TEAM.agentName; // registered on-chain agent name — re-register via scripts/register-team.ts
export const TEAM_DISPLAY = DEV_TEAM.display;
export const RATE_U_PER_HOUR = DEV_TEAM.rateUPerHour;
export const CHUNK_SECONDS = 360;
export const CHUNK_WEI = 1_000_000_000_000_000n; // 0.001 U
export const MAX_CHUNKS = 80; // 8h cap per quote; longer work chains sessions

export const TEAM_ROLES = DEV_TEAM.roles;

export interface Quote {
  team: string;
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
 * minutesOverride wins when given (app-confirmed rental time); otherwise the
 * duration is parsed out of the brief text, else one chunk. */
export function buildQuote(brief: string, budgetU?: unknown, minutesOverride?: number, team: TeamDef = DEV_TEAM): Quote {
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
    team: team.agentName,
    displayName: team.display,
    model: 'rental',
    currency: 'U',
    network: 'bsc-testnet',
    rateUPerHour: team.rateUPerHour,
    chunkSeconds: CHUNK_SECONDS,
    chunkU: weiToU(CHUNK_WEI),
    chunks,
    fundedSeconds,
    totalU: weiToU(totalWei),
    totalWei: totalWei.toString(),
    roles: team.roles,
    escrow: { standard: 'ERC-8183', disputeWindowS: 900 },
    signed: false,
    minutesSource: source,
    note: `Flat rental ${team.rateUPerHour} U/hr, billed in 6-min chunks. ` +
      `This quote rents the whole ${team.display} for ~${Math.round(fundedSeconds / 60)} min. ` +
      `Renew with the same contextId to continue; stop by not renewing.`,
  };
}
