'use client';

import type { JobParams } from './escrow';

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') ?? '';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

export interface ContextStats {
  tokens: number;
  limit: number;
  /** Percent of limit used, one decimal. */
  pct: number;
  model: string;
}

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    // Live state everywhere (threads, clocks, polls) — never serve stale.
    cache: 'no-store',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
  return body as Record<string, unknown>;
}

export interface PendingRent {
  taskId: string;
  contextId: string;
  team: string;
  brief: string;
  minutes: number;
  chunks: number;
  totalU: string;
  totalWei: string;
  token: string;
  status: string;
  jobId: string | null;
  /** Buyer-side escrow params (issued at accept, before anchoring). */
  jobParams?: JobParams | null;
  /** On-chain status of jobId (when known) — a FUNDED job must never fund again. */
  jobStatus?: string | null;
}

export async function getPendingRent(token: string): Promise<PendingRent | null> {
  const body = await api('/rent/pending', token);
  return (body.task as PendingRent) ?? null;
}

export interface LiveCrew {
  taskId: string;
  team: string;
  teamId: string;
  status: string;
  jobId: string | null;
  fundedSeconds: number;
  elapsedSeconds: number;
  minutesLeft: number;
  vmLive: boolean;
  vmSuspended: boolean;
  brief: string;
  renewalJobId?: string | null;
  members: { role: string; name: string; title: string }[];
  /** Roles allowed on the mic (voice concierge default: lead only). */
  speakRoles?: string[];
}

export async function getLiveTeam(token: string): Promise<LiveCrew[]> {
  const body = await api('/rent/team', token);
  return (body.crews as LiveCrew[]) ?? [];
}

export async function terminateSandbox(token: string, taskId: string): Promise<void> {
  await api('/rent/sandbox/terminate', token, {
    method: 'POST',
    body: JSON.stringify({ taskId }),
  });
}

export interface SandboxStatus {
  state: string;
  computerId?: string | null;
  vmId?: string | null;
  vmLive: boolean;
  vmSuspended: boolean;
  bootedAt?: string | null;
  updatedAt?: string | null;
}

export async function getSandboxStatus(token: string): Promise<SandboxStatus | null> {
  try {
    const body = await api('/rent/sandbox/status', token);
    return {
      state: String((body as any).state ?? 'none'),
      computerId: (body as any).computerId ?? null,
      vmId: (body as any).vmId ?? null,
      vmLive: !!(body as any).vmLive,
      vmSuspended: !!(body as any).vmSuspended,
      bootedAt: (body as any).bootedAt ?? null,
      updatedAt: (body as any).updatedAt ?? null,
    };
  } catch {
    return null;
  }
}

export async function bootSandbox(token: string): Promise<void> {
  await api('/rent/sandbox/boot', token, { method: 'POST' });
}

export async function resumeSandbox(token: string): Promise<void> {
  await api('/rent/sandbox/resume', token, { method: 'POST' });
}

export async function flushSandbox(token: string): Promise<void> {
  await api('/rent/sandbox/suspend', token, { method: 'POST', body: '{}' });
}

export async function getSandboxToken(token: string): Promise<{ authToken: string; endpoint: string }> {
  const body = await api('/rent/sandbox/token', token, { method: 'POST' });
  return { authToken: String((body as any).authToken), endpoint: String((body as any).endpoint) };
}

export async function getMemberHistory(
  token: string,
  taskId: string,
  role: string,
): Promise<{ messages: ChatMessage[]; context: ContextStats | null; kickoffStarted: boolean }> {
  const body = await api(`/rent/messages?taskId=${encodeURIComponent(taskId)}&role=${encodeURIComponent(role)}`, token);
  return {
    messages: body.messages as ChatMessage[],
    context: (body.context as ContextStats) ?? null,
    kickoffStarted: !!(body as { kickoffStarted?: unknown }).kickoffStarted,
  };
}

export interface RentTeam {
  id: string;
  name: string;
  description: string;
  rateUPerHour: string;
  chunkMinutes: number;
  roles: string[];
  status: string;
  cardUrl: string;
  /** Custom teams only: member slugs for add/remove. */
  members?: { role: string; name: string; title: string }[];
}

export async function getTeams(token: string): Promise<RentTeam[]> {
  const body = await api('/rent/teams', token);
  return (body.teams as RentTeam[]) ?? [];
}

export interface CustomMemberInput {
  role: string;
  name: string;
  title: string;
  brief: string;
}

export async function createTeam(
  token: string,
  body: { name: string; description?: string; members: CustomMemberInput[] },
): Promise<{ teamId: string; name: string; members: number }> {
  const out = await api('/rent/teams', token, { method: 'POST', body: JSON.stringify(body) });
  return out as unknown as { teamId: string; name: string; members: number };
}

export async function updateTeam(
  token: string,
  body: { teamId: string; add?: CustomMemberInput; remove?: string },
): Promise<{ teamId: string; name: string; members: { role: string; name: string; title: string }[] }> {
  const out = await api('/rent/teams', token, { method: 'PUT', body: JSON.stringify(body) });
  return out as unknown as { teamId: string; name: string; members: { role: string; name: string; title: string }[] };
}

export async function deleteTeam(token: string, teamId: string): Promise<void> {
  await api(`/rent/teams?teamId=${encodeURIComponent(teamId)}`, token, { method: 'DELETE' });
}

/** Direct quote for modal hire (same rent_quote path the hire flow uses). */
export async function createQuote(
  token: string,
  body: { teamId: string; minutes: number; brief?: string; renewTaskId?: string },
): Promise<PendingRent> {
  const out = await api('/rent/teams', token, {
    method: 'POST',
    body: JSON.stringify({ action: 'quote', ...body }),
  });
  return out.task as PendingRent;
}

export type CrewRunStart = { runId: string } | { booting: true };

/**
 * Start one member run. Agentic runs outlive the gateway clock, so this
 * returns immediately: either a runId to poll, or booting (sandbox is
 * spinning up — poll sandbox status, then retry).
 */
export async function startCrewChat(
  token: string,
  taskId: string,
  role: string,
  message: string,
  opts?: { attachments?: string[]; provider?: string; model?: string },
): Promise<CrewRunStart> {
  const out = await api('/rent/crew/chat', token, {
    method: 'POST',
    body: JSON.stringify({ taskId, role, message, ...(opts ?? {}) }),
  });
  if (out.runId) return { runId: out.runId as string };
  return { booting: true };
}

export interface CrewPoll {
  text: string;
  nextCursor: number;
  done: boolean;
  note: string | null;
  approval: { approvalId: string; permission: string; target: string } | null;
  activity: string[];
  toolCalls: number | null;
}

export async function pollCrewChat(
  token: string,
  taskId: string,
  role: string,
  runId: string,
  cursor: number,
): Promise<CrewPoll> {
  const out = await api(
    `/rent/crew/chat?taskId=${encodeURIComponent(taskId)}&role=${encodeURIComponent(role)}&runId=${encodeURIComponent(runId)}&cursor=${cursor}`,
    token,
  );
  return {
    text: (out.text as string) ?? '',
    nextCursor: (out.nextCursor as number) ?? cursor,
    done: !!out.done,
    note: (out.note as string | null) ?? null,
    approval: (out.approval as CrewPoll['approval']) ?? null,
    activity: ((out.activity ?? []) as unknown[]).map((a) => String(a)).slice(0, 8),
    toolCalls: typeof out.toolCalls === 'number' ? (out.toolCalls as number) : null,
  };
}

/** Add a bot to a live (working) rental mid-run. 202 joining — the newcomer
 * boots async; poll the roster/history to confirm. Billing is per-team, so
 * an extra member costs nothing extra. */
export async function addCrewMember(
  token: string,
  body: { taskId: string; add: CustomMemberInput; saveToTeam?: boolean },
): Promise<{ role: string; name: string; savedToTeam: string | null }> {
  const out = await api('/rent/io/crew/add-member', token, { method: 'POST', body: JSON.stringify(body) });
  return { role: String(out.role), name: String(out.name), savedToTeam: (out.savedToTeam as string | null) ?? null };
}

/** Mint a browser WebRTC token for this rental's Speech Engine. */
export async function mintVoiceToken(
  token: string,
  taskId: string,
  speakers?: string[],
): Promise<{ token: string; engineId: string; maxDurationSeconds: number }> {
  const qs =
    `?taskId=${encodeURIComponent(taskId)}` +
    (speakers && speakers.length > 0 ? `&speakers=${encodeURIComponent(speakers.join(','))}` : '');
  const out = await api(`/rent/io/voice/token${qs}`, token);
  return {
    token: String(out.token),
    engineId: String(out.engineId ?? ''),
    maxDurationSeconds: Number(out.maxDurationSeconds ?? 600),
  };
}

/** Current guest share link id, if any (owner only). */
export async function getGuestLink(token: string, taskId: string): Promise<{ linkId: string | null }> {
  const out = await api(`/rent/io/voice/guest-link?taskId=${encodeURIComponent(taskId)}`, token);
  return { linkId: (out.linkId as string | null) ?? null };
}

/** Create (or rotate) the guest share link for a rental (owner only). */
export async function createGuestLink(token: string, taskId: string): Promise<{ linkId: string }> {
  const out = await api(`/rent/io/voice/guest-link?taskId=${encodeURIComponent(taskId)}`, token, { method: 'POST' });
  return { linkId: String(out.linkId) };
}

/** Revoke the guest share link (owner only). */
export async function deleteGuestLink(token: string, taskId: string): Promise<void> {
  await api(`/rent/io/voice/guest-link?taskId=${encodeURIComponent(taskId)}`, token, { method: 'DELETE' });
}

/** Public guest config: team, greeting, rental window. No secrets. */
export async function getGuestVoiceConfig(
  linkId: string,
): Promise<{ team: string; greeting: string | null; minutesLeft: number; status: string }> {
  const out = await api(`/rent/io/voice/guest-config?linkId=${encodeURIComponent(linkId)}`, null);
  return {
    team: String(out.team ?? 'Voice Crew'),
    greeting: (out.greeting as string | null) ?? null,
    minutesLeft: Number(out.minutesLeft ?? 0),
    status: String(out.status ?? ''),
  };
}

/** Public guest token mint: the link id IS the credential. */
export async function mintGuestVoiceToken(linkId: string): Promise<{ token: string; engineId: string; maxDurationSeconds: number }> {
  const out = await api(`/rent/io/voice/guest-token?linkId=${encodeURIComponent(linkId)}`, null);
  return { token: String(out.token), engineId: String(out.engineId ?? ''), maxDurationSeconds: Number(out.maxDurationSeconds ?? 600) };
}

export interface VoiceTurn {
  vid: number;
  who: 'you' | 'aria';
  text: string;
  at: string;
}

/** Talk UI flush: browser-kept call turns land in thread history. Silent by design. */
export async function postVoiceTranscript(
  token: string,
  taskId: string,
  callId: string,
  turns: VoiceTurn[],
): Promise<void> {
  await api('/rent/io/voice/transcript', token, {
    method: 'POST',
    body: JSON.stringify({ taskId, callId, turns }),
  });
}

/** Guest Talk UI flush: link id IS the credential. Silent by design. */
export async function postGuestVoiceTranscript(
  linkId: string,
  callId: string,
  turns: VoiceTurn[],
): Promise<void> {
  await api('/rent/io/voice/guest-transcript', null, {
    method: 'POST',
    body: JSON.stringify({ linkId, callId, turns }),
  });
}

/** Reset one member thread's model session (transcript stays readable). */
export async function clearCrewContext(
  token: string,
  taskId: string,
  role: string,
): Promise<{ cleared: boolean; tokens: number; limit: number; pct: number }> {
  const out = await api(
    `/rent/io/crew/context?taskId=${encodeURIComponent(taskId)}&role=${encodeURIComponent(role)}`,
    token,
    { method: 'DELETE' },
  );
  return {
    cleared: !!out.cleared,
    tokens: Number(out.tokens ?? 0),
    limit: Number(out.limit ?? 0),
    pct: Number(out.pct ?? 0),
  };
}

/** Upload one file into the sandbox workspace (staged under attachments/). */
export async function uploadSandboxFile(token: string, path: string, contentBase64: string): Promise<number> {
  const out = await api('/rent/io/files/upload', token, {
    method: 'POST',
    body: JSON.stringify({ path, contentBase64 }),
  });
  return Number(out.size ?? 0);
}

/** Model catalog for the chat picker. threadDefault names what Auto resolves
 * to on this thread (lead = catalog default, others = cheaper spark). */
export async function getProviders(
  token: string,
  taskId?: string,
  role?: string,
): Promise<{
  defaults: { provider?: string; model?: string };
  models: { provider: string; model: string }[];
  threadDefault: { provider: string; model: string };
}> {
  const qs =
    taskId && role ? `?taskId=${encodeURIComponent(taskId)}&role=${encodeURIComponent(role)}` : '';
  const out = await api(`/rent/io/providers${qs}`, token);
  const defaults = (out.defaults ?? {}) as { provider?: string; model?: string };
  return {
    defaults,
    models: ((out.models ?? []) as { provider: string; model: string }[]).map((m) => ({
      provider: String(m.provider),
      model: String(m.model),
    })),
    threadDefault: {
      provider: String((out.threadDefault as any)?.provider ?? defaults.provider ?? 'meta'),
      model: String((out.threadDefault as any)?.model ?? defaults.model ?? ''),
    },
  };
}

/** Browser WAV bytes → transcript via the VM's ASR proxy. Raw body (audio/wav). */
export async function transcribeVoice(token: string, wav: Blob): Promise<{ transcript: string; audioDurationMs: number }> {
  const res = await fetch(`${API}/rent/io/voice/transcribe`, {
    cache: 'no-store',
    method: 'POST',
    headers: {
      'content-type': 'audio/wav',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: wav,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `transcription failed (${res.status})`);
  return {
    transcript: String((body as { transcript?: unknown }).transcript ?? ''),
    audioDurationMs: Number((body as { audioDurationMs?: unknown }).audioDurationMs ?? 0),
  };
}

export interface PendingApproval {
  id: string;
  permission: string;
  target: string;
  requestedAt: string;
}

export interface PendingQuestion {
  id: string;
  requestedAt: string;
  questions: { header: string; question: string; options: { label: string; description: string }[] }[];
}

/** Gates parked on one run (approvals + questions). Empty = keep polling. */
export async function getGates(
  token: string,
  taskId: string,
  role: string,
  runId: string,
): Promise<{ approvals: PendingApproval[]; questions: PendingQuestion[]; botRequests: PendingBotRequest[] }> {
  const out = await api(
    `/rent/io/crew/gates?taskId=${encodeURIComponent(taskId)}&role=${encodeURIComponent(role)}&runId=${encodeURIComponent(runId)}`,
    token,
  );
  return {
    approvals: ((out.approvals ?? []) as PendingApproval[]).map((g) => ({
      id: String(g.id),
      permission: String(g.permission ?? ''),
      target: String(g.target ?? ''),
      requestedAt: String(g.requestedAt ?? ''),
    })),
    questions: ((out.questions ?? []) as PendingQuestion[]).map((g) => ({
      id: String(g.id),
      requestedAt: String(g.requestedAt ?? ''),
      questions: (g.questions ?? []).map((qq) => ({
        header: String(qq.header ?? ''),
        question: String(qq.question ?? ''),
        options: (qq.options ?? []).map((o: { label?: unknown; description?: unknown }) => ({
          label: String(o.label ?? ''),
          description: String(o.description ?? ''),
        })),
      })),
    })),
    botRequests: ((out.botRequests ?? []) as PendingBotRequest[]).map((g) => ({
      id: String(g.id),
      kind: String(g.kind ?? 'create'),
      name: String(g.name ?? ''),
      role: String(g.role ?? ''),
      description: String(g.description ?? ''),
      requestedAt: String(g.requestedAt ?? ''),
    })),
  };
}

export async function resolveApproval(
  token: string,
  id: string,
  decision: 'approve' | 'reject' | 'approve-all',
): Promise<void> {
  await api(`/rent/io/crew/gates/approvals/${encodeURIComponent(id)}`, token, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}

export async function answerQuestions(token: string, id: string, answers: string[][]): Promise<void> {
  await api(`/rent/io/crew/gates/questions/${encodeURIComponent(id)}`, token, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

export interface PendingBotRequest {
  id: string;
  kind: string;
  name: string;
  role: string;
  description: string;
  requestedAt: string;
}

export interface WorkspaceEntry {
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
}

/** Workspace file list for one sandbox (Library tab source). */
export async function listWorkspaceFiles(token: string, path = ''): Promise<{ path: string; entries: WorkspaceEntry[] }> {
  const out = await api(`/rent/io/crew/files?path=${encodeURIComponent(path)}`, token);
  return {
    path: String(out.path ?? path),
    entries: ((out.entries ?? []) as WorkspaceEntry[]).map((e) => ({
      name: String(e.name),
      dir: !!e.dir,
      size: Number(e.size ?? 0),
      mtime: Number(e.mtime ?? 0),
    })),
  };
}

/** Download one workspace file via session auth (no tokens in URLs/logs). */
export async function downloadWorkspaceFile(token: string | null, path: string): Promise<void> {
  const res = await fetch(`${API}/rent/io/crew/files/download?path=${encodeURIComponent(path)}`, {
    cache: 'no-store',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = path.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/** Compact one member thread (summarize head, keep tail). */
export async function compactCrewContext(
  token: string,
  taskId: string,
  role: string,
): Promise<{ tokens: number; limit: number; pct: number; note: string }> {
  const out = await api(
    `/rent/io/crew/context/compact?taskId=${encodeURIComponent(taskId)}&role=${encodeURIComponent(role)}`,
    token,
    { method: 'POST' },
  );
  return {
    tokens: Number(out.tokens ?? 0),
    limit: Number(out.limit ?? 0),
    pct: Number(out.pct ?? 0),
    note: String(out.note ?? ''),
  };
}

/** Bot-creation request parked on one run (crew proposes, buyer confirms). */
export async function answerBotRequest(token: string, id: string, decision: 'confirm' | 'cancel'): Promise<void> {
  await api(`/rent/io/crew/gates/bot-requests/${encodeURIComponent(id)}`, token, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}

/** Mint a signed dev-preview URL (15-min valid) for the sandbox port 5173. */
export async function mintPreview(token: string, port = 5173): Promise<{ path: string; url: string }> {
  const out = await api('/rent/preview/token', token, {
    method: 'POST',
    body: JSON.stringify({ scope: 'dev', port }),
  });
  const path = String(out.path);
  return { path, url: `${API}${path}` };
}

/** Sandbox MCP registry (the team's tool connectors). Relayed through the
 * backend — secret values never leave the computer (list shows key names). */
export interface McpServerInfo {
  name: string;
  type: 'stdio' | 'remote';
  isActive: boolean;
  configKeys: string[];
  disabledTools: string[];
  status: 'connected' | 'error' | 'unknown';
  tools: number;
  lastError?: string;
}

async function mcpRelay(token: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return api('/rent/io/mcp', token, { method: 'POST', body: JSON.stringify(body) });
}

export async function getMcpServers(token: string): Promise<McpServerInfo[]> {
  const out = await mcpRelay(token, { op: 'list' });
  return (out.servers as McpServerInfo[]) ?? [];
}

export async function saveMcpServer(
  token: string,
  cfg: { name: string; url?: string; headers?: Record<string, string>; disabledTools?: string[] },
): Promise<McpServerInfo[]> {
  const out = await mcpRelay(token, { op: 'save', ...cfg });
  return (out.servers as McpServerInfo[]) ?? [];
}

export async function patchMcpServer(
  token: string,
  name: string,
  cfg: { url?: string; headers?: Record<string, string>; isActive?: boolean; disabledTools?: string[] },
): Promise<McpServerInfo[]> {
  const out = await mcpRelay(token, { op: 'patch', name, ...cfg });
  return (out.servers as McpServerInfo[]) ?? [];
}

export async function restartMcpServer(token: string, name: string): Promise<McpServerInfo[]> {
  const out = await mcpRelay(token, { op: 'restart', name });
  return (out.servers as McpServerInfo[]) ?? [];
}

export async function removeMcpServer(token: string, name: string): Promise<McpServerInfo[]> {
  const out = await mcpRelay(token, { op: 'remove', name });
  return (out.servers as McpServerInfo[]) ?? [];
}

/** Sandbox skills (what the bots know). Relayed; install happens via chat. */
export interface InstalledSkill {
  name: string;
  description?: string;
  source?: string;
}

export async function getSkills(token: string): Promise<InstalledSkill[]> {
  const out = await api('/rent/io/skills', token, { method: 'POST', body: JSON.stringify({ op: 'list' }) });
  return (out.skills as InstalledSkill[]) ?? [];
}

export async function removeSkill(token: string, name: string): Promise<InstalledSkill[]> {
  const out = await api('/rent/io/skills', token, { method: 'POST', body: JSON.stringify({ op: 'remove', name }) });
  return (out.skills as InstalledSkill[]) ?? [];
}

export interface SkillPreview {
  name: string;
  description: string;
  source: string;
  files: Array<{ path: string } | string>;
}

export interface SkillResolveResult {
  preview?: SkillPreview;
  choices?: Array<{ name?: string; path?: string; description?: string }>;
  hint?: string;
  error?: string;
}

/** Preview a skill source before installing (read-only). */
export async function resolveSkill(token: string, source: string): Promise<SkillResolveResult> {
  const out = await api('/rent/io/skills', token, { method: 'POST', body: JSON.stringify({ op: 'resolve', source }) });
  return out as SkillResolveResult;
}

/** Install a previewed skill source (confirm in UI first). */
export async function installSkill(
  token: string,
  source: string,
  overwrite = false,
): Promise<{ skills?: InstalledSkill[]; choices?: unknown; hint?: string; error?: string }> {
  const out = await api('/rent/io/skills', token, {
    method: 'POST',
    body: JSON.stringify({ op: 'install', source, overwrite }),
  });
  return out as { skills?: InstalledSkill[]; choices?: unknown; hint?: string; error?: string };
}

/** Sandbox permission rules (what bots may do unsupervised). Relayed. */
export interface PermissionRule {
  action?: string;
  pattern?: string;
  decision?: string;
  [key: string]: unknown;
}

export async function getPermissions(token: string): Promise<{ rules: PermissionRule[]; canUndo: boolean }> {
  const out = await api('/rent/io/permissions', token, { method: 'POST', body: JSON.stringify({ op: 'get' }) });
  return { rules: (out.rules as PermissionRule[]) ?? [], canUndo: !!out.canUndo };
}

export async function setPermissions(token: string, rules: PermissionRule[]): Promise<PermissionRule[]> {
  const out = await api('/rent/io/permissions', token, { method: 'POST', body: JSON.stringify({ op: 'set', rules }) });
  return (out.rules as PermissionRule[]) ?? [];
}

export async function undoPermissions(token: string): Promise<{ rules: PermissionRule[]; canUndo: boolean }> {
  const out = await api('/rent/io/permissions', token, { method: 'POST', body: JSON.stringify({ op: 'undo' }) });
  return { rules: (out.rules as PermissionRule[]) ?? [], canUndo: !!out.canUndo };
}
