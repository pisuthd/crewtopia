import { TEAM_DISPLAY, TEAM_ID, TEAM_ROLES, RATE_U_PER_HOUR, CHUNK_SECONDS } from '../pricelist';

// Team registry for Ember's list_teams tool. One row per rentable crew.
// A second A2A (e.g. Studio) joins by adding a row here — Ember never
// hardcodes team count. Moves to DynamoDB when teams become dynamic.
export interface TeamEntry {
  id: string;
  name: string;
  description: string;
  rateUPerHour: string;
  chunkMinutes: number;
  roles: string[];
  status: 'available' | 'soon';
  cardUrl: string;
}

const API = 'https://8lgt6x9mn8.execute-api.ap-southeast-1.amazonaws.com/prod';

export const TEAMS: TeamEntry[] = [
  {
    id: TEAM_ID,
    name: TEAM_DISPLAY,
    description:
      'Full product crew for rent: PM scopes milestones, UX/UI designs flows, frontend builds the dapp, backend wires APIs and data.',
    rateUPerHour: RATE_U_PER_HOUR,
    chunkMinutes: CHUNK_SECONDS / 60,
    roles: TEAM_ROLES,
    status: 'available',
    cardUrl: `${API}/.well-known/agent-card.json`,
  },
  {
    id: 'studiocrew',
    name: 'Studio Crew',
    description: 'Brand-anchored image generation and precise edits. Landing now, rentable soon.',
    rateUPerHour: RATE_U_PER_HOUR,
    chunkMinutes: CHUNK_SECONDS / 60,
    roles: ['Creative Director', 'Stylist', 'Generator', 'Retoucher'],
    status: 'soon',
    cardUrl: '',
  },
];

export function listTeams(): TeamEntry[] {
  return TEAMS;
}

export function getTeam(id: string): TeamEntry | null {
  return TEAMS.find((t) => t.id === id) ?? null;
}

export type MemberRole = 'pm' | 'ux' | 'frontend' | 'backend';

export interface MemberEntry {
  role: MemberRole;
  name: string;
  title: string;
}

/** Dev Crew members — botName + role passed to the VM on every relay call. */
export const ROSTER: MemberEntry[] = [
  { role: 'pm', name: 'Pippa', title: 'Project Manager' },
  { role: 'ux', name: 'Uxu', title: 'UX/UI Designer' },
  { role: 'frontend', name: 'Fonti', title: 'Frontend Developer' },
  { role: 'backend', name: 'Bex', title: 'Backend Developer' },
];

export function getMember(role: string): MemberEntry | null {
  return ROSTER.find((m) => m.role === role) ?? null;
}

/** Per-role system briefs injected on every VM relay call (no image rebuild needed). */
export const ROLE_BRIEFS: Record<MemberRole, string> = {
  pm: 'You are Pippa, the Project Manager of the Crewtopia Dev Crew, working a rented session. Scope work into milestones, track acceptance, and coordinate Uxu/Fonti/Bex. Be concise. Never claim work is done until it is.',
  ux: 'You are Uxu, the UX/UI Designer of the Crewtopia Dev Crew, working a rented session. Own flows, wireframes, and component specs. Be concise and concrete.',
  frontend: 'You are Fonti, the Frontend Developer of the Crewtopia Dev Crew, working a rented session. Build the dapp in the workspace, run the dev server, and share preview status. Be concise.',
  backend: 'You are Bex, the Backend Developer of the Crewtopia Dev Crew, working a rented session. Own APIs, DB/auth, indexing, and wiring to on-chain contracts and third-party services. Be concise.',
};
