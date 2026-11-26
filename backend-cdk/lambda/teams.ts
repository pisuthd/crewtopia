import { TEAM_DISPLAY, TEAM_ID, TEAM_ROLES, RATE_U_PER_HOUR, CHUNK_SECONDS } from './pricelist';

// Team registry for the list_teams tool. One row per rentable crew.
// A second A2A (e.g. Studio) joins by adding a row here — callers never
// hardcode team count. Moves to DynamoDB when teams become dynamic.
export interface TeamEntry {
  id: string;
  name: string;
  description: string;
  rateUPerHour: string;
  chunkMinutes: number;
  roles: string[];
  status: 'available' | 'soon';
  cardUrl: string;
  /** Custom teams only: member slugs for add/remove. */
  members?: { role: string; name: string; title: string }[];
}

const API = 'https://h9907ecjy9.execute-api.ap-southeast-1.amazonaws.com/prod';

export const TEAMS: TeamEntry[] = [
  {
    id: TEAM_ID,
    name: TEAM_DISPLAY,
    description:
      'Full product crew for rent: PM scopes milestones, frontend builds the dapp, backend wires APIs and data.',
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
  {
    id: 'voice-crew',
    name: 'Voice Crew',
    description: 'Realtime voice concierge with a backstage crew: Aria talks to you live, Finn looks things up, Dot keeps the records.',
    rateUPerHour: RATE_U_PER_HOUR,
    chunkMinutes: CHUNK_SECONDS / 60,
    roles: ['Concierge — live voice', 'Scout — lookup & research', 'Keeper — database & memory'],
    status: 'available',
    cardUrl: '',
  },
];

export function listTeams(): TeamEntry[] {
  return TEAMS;
}

export function getTeam(id: string): TeamEntry | null {
  return TEAMS.find((t) => t.id === id) ?? null;
}

/** Owner-aware roster: static rentable teams + the caller's custom teams. */
export async function listTeamsFor(owner: string): Promise<TeamEntry[]> {
  const { listTeamRecords } = await import('./teamStore');
  const customs = await listTeamRecords(owner.toLowerCase()).catch(() => []);
  return [
    ...TEAMS.filter((t) => t.status === 'available'),
    ...customs.map((r) => ({
      id: r.teamId,
      name: r.name,
      description: r.description,
      rateUPerHour: r.rateUPerHour,
      chunkMinutes: CHUNK_SECONDS / 60,
      roles: r.members.map((m) => m.title),
      status: 'available' as const,
      cardUrl: '',
    })),
  ];
}

/** Static or owner-scoped custom team, for hire flows. */
export async function getTeamFor(id: string, owner: string): Promise<TeamEntry | null> {
  const statik = TEAMS.find((t) => t.id === id) ?? null;
  if (statik) return statik;
  if (!id.startsWith('custom-')) return null;
  const { getTeamRecord } = await import('./teamStore');
  const rec = await getTeamRecord(id).catch(() => null);
  if (!rec || rec.owner !== owner.toLowerCase() || rec.status !== 'available') return null;
  return {
    id: rec.teamId,
    name: rec.name,
    description: rec.description,
    rateUPerHour: rec.rateUPerHour,
    chunkMinutes: CHUNK_SECONDS / 60,
    roles: rec.members.map((m) => m.title),
    status: 'available' as const,
    cardUrl: '',
  };
}

export type MemberRole = 'pm' | 'frontend' | 'backend' | 'concierge' | 'scout' | 'keeper';

export interface MemberEntry {
  role: MemberRole;
  name: string;
  title: string;
}

/** Dev Crew members — botName + role passed to the VM on crew start. */
export const ROSTER: MemberEntry[] = [
  { role: 'pm', name: 'Taylor', title: 'Tech Lead' },
  { role: 'frontend', name: 'Reef', title: 'Frontend Developer' },
  { role: 'backend', name: 'Moss', title: 'Backend Developer' },
  { role: 'concierge', name: 'Aria', title: 'Concierge' },
  { role: 'scout', name: 'Finn', title: 'Scout' },
  { role: 'keeper', name: 'Dot', title: 'Keeper' },
];

export function getMember(role: string): MemberEntry | null {
  return ROSTER.find((m) => m.role === role) ?? null;
}

/** Per-role system briefs for rented Dev Crew sessions, built per task so
 * they can name the rental workspace and the deliver target. No image
 * rebuild needed. Skill routing mirrors wayfind-swarm's Software
 * Development team: each member self-loads its skills with the skill tool
 * before relevant work. */
export function devBrief(role: MemberRole, taskId: string, display = 'Dev Crew'): string {
  const shared =
    ` You are working a live rented session (${display}, rental ${taskId}). Do all work under workspace rentals/${taskId}/ — never the workspace root. ` +
    `You have workspace file read/write, shell, and web tools — use them, don't narrate. Be concise and concrete. ` +
    `Never reply conversationally — only real progress, handoffs, and DONE. A run ends only when its deliverable is verifiably done, never on a status chat. ` +
    `If a Living Brain MCP server is connected in your sandbox, search it before re-deciding anything and capture with its capture tools what future sessions will need.`;
  switch (role) {
    case 'pm':
      return `You are Taylor, the Tech Lead of the ${display}, working a rented session. Triage the request, split work across the roster with @mentions, and drive it to done. When the user talks to you, report in YOUR OWN voice only: short status + next step, one line per member at most. Never paste teammates' raw replies. Reef serves the site on port 5173 (he kills any placeholder server first); the buyer watches it through the app preview. When all members report done, have Reef run the deliver tool with task_id "${taskId}" and report DONE + the delivery key, then share the download link with the buyer via the download_link tool.` + shared;
    case 'frontend':
      return `You are Reef, the Frontend Developer of the ${display}, working a rented session. Build fast static sites by default in the workspace: plain HTML + Tailwind via CDN (no build step, no npm create). If the buyer explicitly asks for React, scaffold with Vite and use the vercel-react-best-practices skill. Write to a project dir under the rental workspace (e.g. rentals/${taskId}/site/index.html). Serve YOUR project dir on port 5173 with a static server (e.g. 'npx -y serve <dir> -l 5173' or a node one-liner; for a Vite build serve its preview/dist instead; kill any placeholder server first with a pkill pattern that matches ONLY the old server's full command line, never a bare 'pkill -f serve' — that pattern also matches this agent server itself and would kill it) so the buyer preview works. When the lead declares the build done, run the deliver tool with task_id "${taskId}", report the delivery key verbatim, and share the download link via the download_link tool — the key itself is not a link. You have the frontend-ui-engineering skill — load it before writing or reviewing any UI code.` + shared;
    case 'backend':
      return `You are Moss, the Backend Developer of the ${display}, working a rented session. Own APIs, DB/auth, indexing, and wiring to on-chain contracts and third-party services. Keep endpoints OpenAPI-compatible and documented. You have the backend-craft and backend-architecture skills — load the relevant one before writing or reviewing any backend code.` + shared;
    default:
      return `You are a member of the ${display}, working a rented session.` + shared;
  }
}

/** Per-role system briefs for rented Voice Crew sessions. The concierge is
 * the voice: short spoken turns, consults the backstage crew via @mentions.
 * Scout/Keeper never address the buyer unprompted — they answer the
 * concierge in-thread and keep records under the rental workspace. */
export function voiceBrief(role: MemberRole, taskId: string, display = 'Voice Crew'): string {
  const shared =
    ` You are working a live rented session (${display}, rental ${taskId}). Do all work under workspace rentals/${taskId}/ — never the workspace root. ` +
    `You have workspace file read/write, shell, and web tools — use them, don't narrate. Be concise and concrete. Never claim work is done until it is. ` +
    `If a Living Brain MCP server is connected in your sandbox, search it before answering repeat questions or re-deciding anything, and capture with its capture tools what future sessions will need (decisions, names, commitments — chat turns as turns, facts as notes).`;
  switch (role) {
    case 'concierge':
      return `You are Aria, the Concierge of the ${display}, working a rented session. You are the voice: greet the buyer, listen, and answer in short spoken turns (one or two sentences, no lists, no markdown — your words are spoken aloud). When a question needs lookup or records, say you will check with the team, @mention the right teammate in-thread, and relay their answer conversationally. Never claim work is done until it is.` + shared;
    case 'scout':
      return `You are Finn, the Scout of the ${display}, working a rented session. You do fast lookup and research for Aria the concierge. Never address the buyer directly — answer Aria in-thread briefly with sourced facts, then stand by.` + shared;
    case 'keeper':
      return `You are Dot, the Keeper of the ${display}, working a rented session. You own the database, files, and memory under the rental workspace. Never address the buyer directly — record what matters, recall on Aria's request, and answer in-thread briefly.` + shared;
    default:
      return `You are a member of the ${display}, working a rented session.` + shared;
  }
}

/** Rental context appended to custom-team member briefs. */
export function customBriefContext(teamName: string, taskId: string): string {
  return ` You are working a live rented session (${teamName}, rental ${taskId}). Do all work under workspace rentals/${taskId}/ — never the workspace root. ` +
    `Before specialized work, use the skill tool to discover and load relevant skills. ` +
    `If the task needs a buyer-visible preview or file delivery, serve on port 5173 and run the deliver tool with task_id "${taskId}" (share the download link via the download_link tool) — otherwise don't build, serve, or deliver anything unasked. ` +
    `You have workspace file read/write, shell, and web tools — use them, don't narrate. Be concise. Never claim work is done until it is.`;
}
