// Custom team registry (user-defined crews). Static teams (dev/studio) live
// in pricelist.ts; custom teams live here, one row per team, owned by a
// wallet. Wire ids are namespaced `custom-<addr6>-<slug>` so teamIds stay
// globally unique without a GSI. v1: flat rate for everyone, no on-chain
// registration or agent card for custom teams (same provider rails).
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DEV_TEAM, TEAM_REGISTRY, type TeamDef } from './pricelist';
import { ROSTER, customBriefContext, devBrief, voiceBrief, type MemberRole } from './teams';

export interface RosterEntry {
  role: string;
  name: string;
  title: string;
  brief: string;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TEAM_REGISTRY_TABLE ?? '';

function table(): string {
  if (!TABLE) throw new Error('server misconfigured: TEAM_REGISTRY_TABLE is not set');
  return TABLE;
}

export interface CustomMember {
  role: string;
  name: string;
  title: string;
  brief: string;
}

export interface TeamRecord {
  teamId: string;
  owner: string;
  name: string;
  description: string;
  members: CustomMember[];
  rateUPerHour: string;
  status: 'available';
  createdAt: string;
  updatedAt: string;
}

const MAX_MEMBERS = 6;

function fail(msg: string): never {
  throw new Error(msg);
}

function cleanSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  if (!slug) fail('name must contain letters or numbers');
  return slug;
}

export function cleanMember(m: any, i: number): CustomMember {
  const role = String(m?.role ?? '').toLowerCase().trim();
  const name = String(m?.name ?? '').trim();
  const title = String(m?.title ?? '').trim();
  const brief = String(m?.brief ?? '').trim();
  if (!/^[a-z0-9-]{1,24}$/.test(role)) fail(`member ${i}: role must be 1-24 chars [a-z0-9-]`);
  if (!name || name.length > 40) fail(`member ${i}: name 1-40 chars`);
  if (!title || title.length > 60) fail(`member ${i}: title 1-60 chars`);
  if (!brief || brief.length > 2000) fail(`member ${i}: brief 1-2000 chars`);
  return { role, name, title, brief };
}

/** Validate + build a TeamRecord (id assigned server-side). */
export function buildTeamRecord(owner: string, body: any): TeamRecord {
  const name = String(body?.name ?? '').trim();
  const description = String(body?.description ?? '').trim();
  if (!name || name.length > 60) fail('name must be 1-60 chars');
  if (description.length > 500) fail('description max 500 chars');
  const raw = Array.isArray(body?.members) ? body.members : [];
  if (raw.length < 1 || raw.length > MAX_MEMBERS) fail(`members must be 1-${MAX_MEMBERS}`);
  const members: CustomMember[] = raw.map(cleanMember);
  const roles = members.map((m) => m.role);
  if (new Set(roles).size !== roles.length) fail('member roles must be unique');
  const now = new Date().toISOString();
  return {
    teamId: `custom-${owner.toLowerCase().slice(2, 8)}-${cleanSlug(name)}`,
    owner: owner.toLowerCase(),
    name,
    description,
    members,
    rateUPerHour: '0.01',
    status: 'available',
    createdAt: now,
    updatedAt: now,
  };
}

export async function getTeamRecord(teamId: string): Promise<TeamRecord | null> {
  const out = await ddb.send(new GetCommand({ TableName: table(), Key: { teamId } }));
  return (out.Item as TeamRecord) ?? null;
}

export async function listTeamRecords(owner: string): Promise<TeamRecord[]> {
  const out = await ddb.send(
    new ScanCommand({
      TableName: table(),
      FilterExpression: '#o = :o',
      ExpressionAttributeNames: { '#o': 'owner' },
      ExpressionAttributeValues: { ':o': owner.toLowerCase() },
    }),
  );
  const items = ((out.Items ?? []) as TeamRecord[]).filter((t) => t.status === 'available');
  items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return items;
}

export async function putTeamRecord(rec: TeamRecord): Promise<void> {
  rec.updatedAt = new Date().toISOString();
  await ddb.send(new PutCommand({ TableName: table(), Item: rec }));
}

export async function deleteTeamRecord(teamId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: table(), Key: { teamId } }));
}

/** Add and/or remove one member on an owned custom team. Roster snapshots on
 * tasks are unaffected (mid-rental edits can't shift a running crew). */
export async function updateTeamMembers(
  owner: string,
  teamId: string,
  add: unknown,
  removeRole: unknown,
): Promise<TeamRecord> {
  const rec = await getTeamRecord(String(teamId ?? '')).catch(() => null);
  if (!rec || rec.owner !== owner.toLowerCase()) fail('unknown team');
  let members = rec.members;
  const remove = String(removeRole ?? '').toLowerCase().trim();
  if (remove) {
    if (!members.some((m) => m.role === remove)) fail(`no member '${remove}' on this team`);
    members = members.filter((m) => m.role !== remove);
  }
  if (add !== undefined && add !== null) {
    const m = cleanMember(add, members.length);
    if (members.some((x) => x.role === m.role)) fail(`role '${m.role}' is already on this team`);
    members = [...members, m];
  }
  if (members.length < 1 || members.length > MAX_MEMBERS) fail(`members must be 1-${MAX_MEMBERS}`);
  rec.members = members;
  await putTeamRecord(rec);
  return rec;
}

/** Custom record → TeamDef shape the quote/card code already speaks. */
export function customToTeamDef(rec: TeamRecord): TeamDef {
  return {
    id: rec.teamId,
    // Same provider rails + on-chain agent as Dev Crew in v1.
    agentName: DEV_TEAM.agentName,
    display: rec.name,
    description: rec.description || `Custom crew: ${rec.members.map((m) => `${m.name} (${m.title})`).join(', ')}.`,
    roles: rec.members.map((m) => m.title),
    memberRoles: rec.members.map((m) => m.role),
    members: rec.members.map((m) => ({ role: m.role, name: m.name, title: m.title, focus: m.title })),
    rateUPerHour: rec.rateUPerHour,
    status: 'available',
  };
}

/**
 * Static registry first, then owner-scoped customs. Custom teams need a
 * bound wallet (owner must match) — unbound browsing only sees static teams.
 * Accepts registry keys ('dev-crew') AND advertised agent names
 * ('crewtopia-dev-crew', what list_teams/rent_quote circulate).
 */
export async function resolveTeamFor(teamId: unknown, owner: string | null): Promise<TeamDef> {
  const raw = teamId === undefined || teamId === null ? '' : String(teamId);
  if (raw === '') return DEV_TEAM;
  const statik = TEAM_REGISTRY[raw] ?? Object.values(TEAM_REGISTRY).find((t) => t.agentName === raw);
  if (statik) return statik;
  const known = Object.keys(TEAM_REGISTRY).join(', ');
  if (!raw.startsWith('custom-')) throw new Error(`unknown team '${raw}'. Known: ${known}`);
  if (!owner) throw new Error(`team '${raw}' is a custom team — bind your wallet first`);
  const rec = await getTeamRecord(raw).catch(() => null);
  if (!rec || rec.owner !== owner.toLowerCase()) {
    throw new Error(`unknown team '${raw}'. Known: ${known}`);
  }
  if (rec.status !== 'available') throw new Error(`team '${raw}' is not rentable (${rec.status})`);
  return customToTeamDef(rec);
}

/** Roster snapshot for a task (stored so mid-rental edits can't shift the crew). */
export async function rosterFor(teamId: string | undefined, owner: string | null, taskId: string): Promise<RosterEntry[]> {
  const raw = teamId ?? '';
  const statik = raw === '' ? DEV_TEAM : (TEAM_REGISTRY[raw] ?? Object.values(TEAM_REGISTRY).find((t) => t.agentName === raw));
  if (statik) {
    const team = statik;
    const briefFor = team.id === 'voice-crew' ? voiceBrief : devBrief;
    return ROSTER.filter((m) => (team.memberRoles as string[]).includes(m.role)).map((m) => ({
      role: m.role,
      name: m.name,
      title: m.title,
      brief: briefFor(m.role as MemberRole, taskId, team.display),
    }));
  }
  const rec = await getTeamRecord(raw).catch(() => null);
  if (!rec || (owner && rec.owner !== owner.toLowerCase())) {
    throw new Error(`unknown team '${raw}'`);
  }
  return rec.members.map((m) => ({ role: m.role, name: m.name, title: m.title, brief: m.brief + customBriefContext(rec.name, taskId) }));
}
