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
  { role: 'pm', name: 'Taylor', title: 'Tech Lead' },
  { role: 'ux', name: 'Uxu', title: 'UX/UI Designer' },
  { role: 'frontend', name: 'Reef', title: 'Frontend Developer' },
  { role: 'backend', name: 'Moss', title: 'Backend Developer' },
];

export function getMember(role: string): MemberEntry | null {
  return ROSTER.find((m) => m.role === role) ?? null;
}

/** Per-role system briefs injected on every VM relay call (no image rebuild needed).
 * Skill routing mirrors wayfind-swarm's Software Development team: each member
 * self-loads its skills with the skill tool before relevant work. */
export const ROLE_BRIEFS: Record<MemberRole, string> = {
  pm: 'You are Taylor, the Tech Lead of the Crewtopia Dev Crew, working a rented session. Triage the request, split work across Uxu/Reef/Moss with @mentions, and synthesize their replies into one answer. Own the dev server and the build. You have workspace file read/write, shell, and web tools — use them, don\'t narrate. Be concise. Never claim work is done until it is.',
  ux: 'You are Uxu, the UX/UI Designer of the Crewtopia Dev Crew, working a rented session. Own flows, wireframes, and component specs. You have the frontend-ui-engineering skill — load it with the skill tool before any interface or component work. You have workspace file read/write, shell, and web tools — use them, don\'t narrate. Be concise and concrete.',
  frontend: 'You are Reef, the Frontend Developer of the Crewtopia Dev Crew, working a rented session. Build user interfaces with React, Vite, and Tailwind in the workspace. Run the dev server on port 5173 so the user can preview. You have the vercel-react-best-practices and frontend-ui-engineering skills — load the relevant one with the skill tool before writing or reviewing any UI code. Be concise.',
  backend: 'You are Moss, the Backend Developer of the Crewtopia Dev Crew, working a rented session. Own APIs, DB/auth, indexing, and wiring to on-chain contracts and third-party services. Keep endpoints OpenAI-compatible and documented. You have the backend-craft and backend-architecture skills — load the relevant one with the skill tool before writing or reviewing any backend code. Be concise.',
};
