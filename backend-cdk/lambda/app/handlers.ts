import { GetMicrovmCommand } from '@aws-sdk/client-lambda-microvms';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { TEAMS, type TeamEntry } from '../teams';
import { CHUNK_SECONDS } from '../pricelist';
import { buildTeamRecord, deleteTeamRecord, getTeamRecord, listTeamRecords, putTeamRecord } from '../teamStore';
import { contextFor } from './context';
import { findCrewsByBuyer, findPendingByBuyer, putTask as putA2aTask } from '../a2a/store';
import { getTask } from '../a2a/store';
import { suspendVm } from '../a2a/relay';
import { vmToken } from '../a2a/vm';
import { getSandbox, putSandbox, resolveSandboxVm } from '../sandboxStore';
import { invokeSandboxFn, microvmsClient, pollRunEvents, startMemberRun } from '../a2a/crewChat';

// ---------- REST ----------

export async function handlePending(address: string) {
  const task = await findPendingByBuyer(address);
  if (!task?.quote) return { statusCode: 200, body: { task: null } };
  // On-chain job state drives the card: a jobId whose job is already FUNDED
  // must never offer fund again (fund() reverts WrongStatus on funded jobs).
  let jobStatus: string | null = null;
  if (task.jobId) {
    try {
      const { JobStatus } = await import('@bnbagent/sdk');
      const { getEscrow } = await import('../a2a/clients');
      const { client: escrow } = await getEscrow();
      const job = await escrow.getJob(BigInt(task.jobId));
      jobStatus = JobStatus[Number(job.status)] ?? String(job.status);
    } catch {
      jobStatus = null;
    }
  }
  return {
    statusCode: 200,
    body: {
      task: {
        taskId: task.taskId,
        contextId: task.contextId,
        team: task.quote.displayName,
        brief: task.brief,
        minutes: Math.round(task.quote.fundedSeconds / 60),
        chunks: task.quote.chunks,
        totalU: task.quote.totalU,
        totalWei: task.quote.totalWei,
        // U (United Stables) on bsc-testnet — the rental settlement token.
        token: '0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565',
        status: task.status,
        jobId: task.jobId,
        jobStatus,
      },
    },
  };
}

/** Public hires feed for the landing explorer (no auth — buyer wallets and
 * escrow jobs are public onchain data; briefs are never included). */
export async function handleHiresList() {
  const { listRecentHires } = await import('../a2a/store');
  const { hires, total } = await listRecentHires(20).catch(() => ({ hires: [], total: 0 }));
  return { statusCode: 200, body: { hires, total } };
}

/** Shared greeting-prompt constant (single source of truth in ../voice). */
import { HELLO_PROMPT } from '../voice';

export async function handleMemberHistory(address: string, params: Record<string, string | undefined>) {
  const owner = address.toLowerCase();
  const taskId = String(params.taskId ?? '');
  const role = String(params.role ?? '').toLowerCase();
  const task = await getTask(taskId);
  if (!task || !task.buyer || task.buyer.toLowerCase() !== owner) {
    return { statusCode: 404, body: { error: 'unknown thread' } };
  }
  const member = (task.roster ?? []).find((m) => m.role === role);
  if (!member) {
    return { statusCode: 404, body: { error: `no member '${role}' on this rental` } };
  }
  // Single source of truth: the VM transcript (wayfind-cloud pattern — the
  // backend never stores chat). No live sandbox (expired/terminated) means
  // an empty thread, not an error; the send path self-heals the VM.
  const sb = await resolveSandboxVm(owner);
  let lines: Array<{ role?: string; text?: string; at?: string }> = [];
  if (sb) {
    try {
      const tokenStr = await vmToken(sb.vmId);
      const cid = encodeURIComponent(`rent:${taskId}#${role}`);
      const r = await fetch(`https://${sb.endpoint}/history/${cid}`, {
        headers: { 'X-aws-proxy-auth': tokenStr },
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) {
        const hb = (await r.json().catch(() => ({}))) as { messages?: unknown };
        if (Array.isArray(hb.messages)) lines = hb.messages as typeof lines;
      }
    } catch {
      // unreachable VM → empty thread
    }
  }
  const messages = lines
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    // Legacy kickoff primers (pre-kind-tagging) read as buyer chat — hide the
    // session primer, keep everything the buyer and crew actually said.
    .filter((m) => !(m.role === 'user' && /^Rental \S+ is now FUNDED and live/.test(m.text as string)))
    // Greeting prompt (Fix A): internal instruction, never render it.
    .filter((m) => !(m.role === 'user' && (m.text as string).trim() === HELLO_PROMPT))
    .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text as string, at: m.at ?? '' }));
  // Fix B: has a kickoff run ever started for this role — or was one
  // launched recently? The tracking write lands minutes after the flip
  // (sandbox boot), so a fresh stamp counts as started with a 15-min TTL.
  // After the TTL with no tracked run, the kickoff is presumed dead and the
  // greeting fallback is allowed through.
  const crewRuns = (task as any).crewRuns ?? {};
  const startingAt = Date.parse(String((task as any).crewStartingAt ?? ''));
  const kickoffStarted =
    !!crewRuns[role] || (Number.isFinite(startingAt) && Date.now() - startingAt < 15 * 60_000);
  return {
    statusCode: 200,
    body: { conversationId: `rent:${taskId}#${role}`, messages, context: contextFor(messages), kickoffStarted },
  };
}

export async function handleTeam(address: string) {
  const tasks = await findCrewsByBuyer(address);
  const { resolveTeamFor } = await import('../teamStore');
  const crews = await Promise.all(
    tasks.map(async (task) => {
      const elapsedS = task.workingSince
        ? Math.max(0, Math.floor((Date.now() - new Date(task.workingSince).getTime()) / 1000))
        : 0;
      // Display name resolved from the team registry — stored quote snapshots
      // predate renames and carry default names for customs.
      let teamName = task.quote?.displayName ?? 'Dev Crew';
      try {
        teamName = (await resolveTeamFor(task.teamId, address)).display;
      } catch {
        // keep the snapshot on unknown teams
      }
      return {
          taskId: task.taskId,
          team: teamName,
          teamId: task.teamId ?? '',
          status: task.status,
          jobId: task.jobId,
          fundedSeconds: task.quote?.fundedSeconds ?? 0,
          elapsedSeconds: elapsedS,
          minutesLeft: Math.max(0, Math.round(((task.quote?.fundedSeconds ?? 0) - elapsedS) / 60)),
          vmLive: !!task.vm?.vmId && !!task.vm?.endpoint && !task.vm?.terminatedAt && !task.vm?.suspendedAt,
          vmSuspended: !!task.vm?.suspendedAt && !task.vm?.terminatedAt,
          brief: task.brief,
          renewalJobId: task.renewalJobId ?? null,
          members: (task.roster ?? []).map((m) => ({ role: m.role, name: m.name, title: m.title })),
        speakRoles: (() => {
          const stored = Array.isArray((task as any).voiceConfig?.speakers) ? (task as any).voiceConfig.speakers : [];
          return stored.length > 0 ? stored.map((r: unknown) => String(r)) : [(task.roster ?? [])[0]?.role ?? 'concierge'];
        })(),
        };
      }),
    );
  return { statusCode: 200, body: { crews } };
}

/** GET /rent/teams (session-authed): static rentable teams + my custom teams. */
export async function handleTeamsList(address: string) {
  const customs = await listTeamRecords(address.toLowerCase()).catch(() => []);
  const teams: TeamEntry[] = [
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
      members: r.members.map((m) => ({ role: m.role, name: m.name, title: m.title })),
    })),
  ];
  return { statusCode: 200, body: { teams } };
}

/** POST /rent/teams (session-authed): create a custom team. */
export async function handleTeamCreate(address: string, body: any) {
  let rec;
  try {
    rec = buildTeamRecord(address, body);
  } catch (e) {
    return { statusCode: 400, body: { error: e instanceof Error ? e.message : 'bad team' } };
  }
  const existing = await getTeamRecord(rec.teamId).catch(() => null);
  if (existing) {
    return { statusCode: 409, body: { error: `team id '${rec.teamId}' already exists — delete it first or rename` } };
  }
  await putTeamRecord(rec);
  return { statusCode: 201, body: { teamId: rec.teamId, name: rec.name, members: rec.members.length } };
}

/** PUT /rent/teams (session-authed): add/remove one bot on my custom team.
 * Body: { teamId, add?: { role, name, title, brief }, remove?: role }.
 * At least one of add/remove; roster snapshots on tasks are unaffected. */
export async function handleTeamUpdate(address: string, body: any) {
  if (!body?.add && !body?.remove) {
    return { statusCode: 400, body: { error: 'needs { teamId, add? and/or remove? }' } };
  }
  const { updateTeamMembers } = await import('../teamStore');
  let rec;
  try {
    rec = await updateTeamMembers(address, String(body?.teamId ?? ''), body?.add ?? null, body?.remove ?? '');
  } catch (e) {
    return { statusCode: 400, body: { error: e instanceof Error ? e.message : 'bad update' } };
  }
  return {
    statusCode: 200,
    body: {
      teamId: rec.teamId,
      name: rec.name,
      members: rec.members.map((m) => ({ role: m.role, name: m.name, title: m.title })),
    },
  };
}

/** POST /rent/crew/add-member (session-authed): add a bot to a LIVE rental
 * mid-run. Body: { taskId, add: { role, name, title, brief }, saveToTeam? }.
 * Appends to the task roster snapshot, then re-invokes start-crew — which
 * only starts runs for roles without tracked crewRuns, so the running crew
 * is undisturbed and just the newcomer boots. The starter nudges the
 * already-running lead about the joiner (see startCrewSession). Billing is
 * per-team per-hour, so an extra member costs nothing extra. */
export async function handleCrewAddMember(address: string, body: any) {
  const owner = address.toLowerCase();
  const taskId = String(body?.taskId ?? '');
  const add = body?.add ?? null;
  if (!taskId || !add) {
    return { statusCode: 400, body: { error: 'needs { taskId, add: { role, name, title, brief } }' } };
  }
  const task = await getTask(taskId);
  if (!task || !task.buyer || task.buyer.toLowerCase() !== owner) {
    return { statusCode: 404, body: { error: 'unknown rental' } };
  }
  if (task.status !== 'working') {
    return { statusCode: 409, body: { error: `rental is ${task.status} — only a working crew can take new members` } };
  }
  const roster = Array.isArray(task.roster) ? task.roster : [];
  if (Object.keys(task.crewRuns ?? {}).length === 0) {
    return { statusCode: 409, body: { error: 'crew still starting — try again in a minute', retryable: true } };
  }
  if (roster.length >= 6) {
    return { statusCode: 400, body: { error: 'crew is full (max 6 members)' } };
  }
  let member;
  try {
    const { cleanMember } = await import('../teamStore');
    member = cleanMember(add, roster.length);
  } catch (e) {
    return { statusCode: 400, body: { error: e instanceof Error ? e.message : 'bad member' } };
  }
  if (roster.some((m) => m.role === member.role)) {
    return { statusCode: 409, body: { error: `role '${member.role}' is already on this crew` } };
  }
  // Fix D: atomic append — the old whole-task put wiped concurrent writers.
  // Intent stamp: a newcomer kickoff is launching; the greeting stays off it.
  const { appendRosterMember, touchTask } = await import('../a2a/store');
  await appendRosterMember(taskId, member);
  await touchTask(taskId, { crewStartingAt: new Date().toISOString() }).catch(() => {});
  // Best-effort: also persist to the template so the next hire includes them.
  let savedToTeam: string | null = null;
  if (body?.saveToTeam && typeof task.teamId === 'string' && task.teamId.startsWith('custom-')) {
    try {
      const { updateTeamMembers } = await import('../teamStore');
      await updateTeamMembers(owner, task.teamId, add, '');
      savedToTeam = task.teamId;
    } catch (e) {
      console.error(`[crew-add-member] template save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await invokeSandboxFn({ internal: true, action: 'start-crew', taskId, wallet: owner }).catch(() => null);
  return {
    statusCode: 202,
    body: { accepted: true, state: 'joining', role: member.role, name: member.name, savedToTeam },
  };
}

/** POST /rent/teams { action: 'quote' } (session-authed): direct quote for
 * modal hire. Same rent_quote path the hire flow uses —
 * explicit minutes only. With renewTaskId: top-up quote on a live rental
 * (same task, clock extends on fund) instead of a second team. */
export async function handleQuoteCreate(address: string, body: any) {
  const owner = address.toLowerCase();
  const renewTaskId = String(body?.renewTaskId ?? '');
  if (renewTaskId) {
    try {
      const task = await getTask(renewTaskId);
      if (!task || !task.buyer || task.buyer.toLowerCase() !== owner) {
        return { statusCode: 404, body: { error: 'unknown rental' } };
      }
      if (task.status !== 'working') {
        return { statusCode: 409, body: { error: `rental is ${task.status} — only live rentals can be topped up` } };
      }
      const teamId = String(body?.teamId ?? '');
      if (teamId && task.teamId && teamId !== task.teamId) {
        return { statusCode: 400, body: { error: 'extension must be for the same team' } };
      }
      const minutes = Number(body?.minutes ?? 0);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return { statusCode: 400, body: { error: 'minutes must be a positive number' } };
      }
      const { buildQuote } = await import('../pricelist');
      const quote = buildQuote('', undefined, minutes);
      task.pendingRenewal = {
        fundedSeconds: quote.fundedSeconds,
        chunks: quote.chunks,
        totalU: quote.totalU,
        totalWei: quote.totalWei,
        createdAt: new Date().toISOString(),
      };
      await putA2aTask(task);
      const teamName = await (async () => {
        try {
          const { resolveTeamFor } = await import('../teamStore');
          return (await resolveTeamFor(teamId || task.teamId, owner)).display;
        } catch {
          return task.quote?.displayName ?? 'team';
        }
      })();
      return {
        statusCode: 200,
        body: {
          task: {
            taskId: task.taskId,
            contextId: task.contextId,
            team: teamName,
            brief: task.brief,
            minutes: Math.round(quote.fundedSeconds / 60),
            chunks: quote.chunks,
            totalU: quote.totalU,
            totalWei: quote.totalWei,
            token: '0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565',
            status: 'working',
            jobId: null,
            renewal: true,
            baselineFundedSeconds: task.quote?.fundedSeconds ?? 0,
          },
        },
      };
    } catch (e) {
      return { statusCode: 400, body: { error: e instanceof Error ? e.message : 'bad renewal quote' } };
    }
  }
  const { rentQuote } = await import('./rent');
  try {
    const q = await rentQuote(
      {
        teamId: String(body?.teamId ?? ''),
        minutes: Number(body?.minutes ?? 0),
        brief: String(body?.brief ?? ''),
      },
      address,
    );
    return {
      statusCode: 200,
      body: {
        task: {
          taskId: q.taskId,
          contextId: q.contextId,
          team: q.team,
          brief: String(body?.brief ?? ''),
          minutes: q.minutes,
          chunks: q.chunks,
          totalU: q.totalU,
          totalWei: q.totalWei,
          token: '0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565',
          status: 'submitted',
          jobId: null,
        },
      },
    };
  } catch (e) {
    return { statusCode: 400, body: { error: e instanceof Error ? e.message : 'bad quote' } };
  }
}

/** DELETE /rent/teams?teamId= (session-authed): delete my custom team. */
export async function handleTeamDelete(address: string, params: Record<string, string | undefined>) {
  const teamId = String(params.teamId ?? '');
  if (!teamId) return { statusCode: 400, body: { error: 'needs ?teamId=' } };
  const rec = await getTeamRecord(teamId).catch(() => null);
  if (!rec || rec.owner !== address.toLowerCase()) {
    return { statusCode: 404, body: { error: 'unknown team' } };
  }
  await deleteTeamRecord(teamId);
  return { statusCode: 200, body: { ok: true, teamId } };
}

/** POST /rent/crew/chat (session-authed): start a member run, return immediately.
 * The gateway clock (~29s) can't cover agentic runs — poll GET /rent/crew/chat
 * for chunks. Hard stop enforced here: expired rentals can't start new runs;
 * polling a started run always works (history stays readable). Optional body:
 * attachments (workspace paths under attachments/, max 5), provider/model
 * (explicit pick overrides the default lead/spark routing for this thread). */
export async function handleCrewChat(address: string, body: any) {
  const r = await startMemberRun(
    address,
    String(body?.taskId ?? ''),
    String(body?.role ?? ''),
    String(body?.message ?? ''),
    {
      ...(body?.attachments !== undefined ? { attachments: body.attachments } : {}),
      ...(body?.provider !== undefined ? { provider: body.provider } : {}),
      ...(body?.model !== undefined ? { model: body.model } : {}),
    },
  );
  return r;
}

/** GET /rent/crew/chat (session-authed): poll one started run. Read-only —
 * polling works even after rental expiry so threads stay readable. */
export async function handleCrewChatPoll(address: string, params: Record<string, string | undefined>) {
  const r = await pollRunEvents(
    address,
    String(params.taskId ?? ''),
    String(params.role ?? ''),
    String(params.runId ?? ''),
    Number(params.cursor ?? 0) || 0,
  );
  return r;
}

/** DELETE /rent/crew/context (session-authed): reset the model's session for
 * one member thread. The transcript stays readable — only the live session
 * (and its token count) resets. Query: ?taskId=&role= */
export async function handleCrewContextClear(address: string, params: Record<string, string | undefined>) {
  const owner = address.toLowerCase();
  const taskId = String(params.taskId ?? '');
  const role = String(params.role ?? '').toLowerCase();
  const task = await getTask(taskId);
  if (!task || !task.buyer || task.buyer.toLowerCase() !== owner) {
    return { statusCode: 404, body: { error: 'unknown thread' } };
  }
  if (!(task.roster ?? []).some((m) => m.role === role)) {
    return { statusCode: 404, body: { error: `no member '${role}' on this rental` } };
  }
  const sb = await resolveSandboxVm(owner);
  if (!sb) return { statusCode: 404, body: { error: 'no live sandbox' } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const r = await fetch(`https://${sb.endpoint}/context/${encodeURIComponent(`rent:${taskId}#${role}`)}`, {
    method: 'DELETE',
    headers: { 'X-aws-proxy-auth': tokenStr },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r || !r.ok) return { statusCode: 502, body: { error: 'sandbox unreachable' } };
  const jb = (await r.json().catch(() => ({}))) as any;
  return {
    statusCode: 200,
    body: { cleared: !!jb.cleared, tokens: jb.tokens ?? 0, limit: jb.limit ?? 0, pct: jb.pct ?? 0 },
  };
}

/** Sandbox proxies (session-authed): the browser never talks to the VM
 * directly — short-lived VM auth stays server-side. */

/** POST /rent/sandbox/files/upload: { path, contentBase64 } → VM. Paths are
 * jailed to attachments/ (VM enforces too); 10MB per file. */
export async function handleSandboxFileUpload(address: string, body: any) {
  const owner = address.toLowerCase();
  const path = String(body?.path ?? '');
  const b64 = String(body?.contentBase64 ?? '');
  if (!path || !b64) return { statusCode: 400, body: { error: 'needs { path, contentBase64 }' } };
  if (!path.startsWith('attachments/') || path.includes('..')) {
    return { statusCode: 400, body: { error: 'path must live under attachments/' } };
  }
  let size = 0;
  try {
    size = Buffer.from(b64, 'base64').length;
  } catch {
    return { statusCode: 400, body: { error: 'bad base64' } };
  }
  if (size > 10 * 1024 * 1024) return { statusCode: 413, body: { error: 'file must be 10MB or less' } };
  const sb = await resolveSandboxVm(owner);
  if (!sb) return { statusCode: 404, body: { error: 'no live sandbox — boot one first' } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const r = await fetch(`https://${sb.endpoint}/files/upload`, {
    method: 'POST',
    headers: { 'X-aws-proxy-auth': tokenStr, 'content-type': 'application/json' },
    body: JSON.stringify({ path, contentBase64: b64 }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!r || !r.ok) return { statusCode: 502, body: { error: 'sandbox unreachable' } };
  return { statusCode: 200, body: { ok: true, path, size } };
}

/** POST /rent/sandbox/voice/transcribe (session-authed, raw audio body):
 * forwards browser WAV bytes to the VM's Meta ASR proxy. */
export async function handleVoiceTranscribe(address: string, audio: Buffer, contentType: string) {
  const owner = address.toLowerCase();
  if (!contentType.startsWith('audio/')) {
    return { statusCode: 400, body: { error: 'Content-Type must be audio/wav' } };
  }
  if (audio.length === 0 || audio.length > 7 * 1024 * 1024) {
    return { statusCode: 413, body: { error: 'audio must be 1B-7MB' } };
  }
  const sb = await resolveSandboxVm(owner);
  if (!sb) return { statusCode: 404, body: { error: 'no live sandbox — boot one first' } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const r = await fetch(`https://${sb.endpoint}/voice/transcribe?ownerId=${encodeURIComponent(owner)}`, {
    method: 'POST',
    headers: { 'X-aws-proxy-auth': tokenStr, 'content-type': 'audio/wav' },
    body: new Uint8Array(audio),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => null);
  if (!r) return { statusCode: 502, body: { error: 'sandbox unreachable' } };
  const jb = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) return { statusCode: r.status, body: { error: String(jb?.error ?? 'transcription failed').slice(0, 300) } };
  return {
    statusCode: 200,
    body: { transcript: String(jb?.transcript ?? ''), audioDurationMs: Number(jb?.audioDurationMs ?? 0) || 0 },
  };
}

/** GET /rent/sandbox/providers (session-authed): model catalog for the chat
 * picker. Query ?taskId=&role= adds threadDefault — what Auto resolves to
 * on that thread (lead = catalog default, others = cheaper spark), computed
 * with the same rule startMemberRun applies. The picker labels Auto with it
 * so the button never misleads. */
export async function handleProviders(address: string, params?: Record<string, string | undefined>) {
  const owner = address.toLowerCase();
  const sb = await resolveSandboxVm(owner);
  if (!sb) return { statusCode: 404, body: { error: 'no live sandbox — boot one first' } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const r = await fetch(`https://${sb.endpoint}/providers`, {
    headers: { 'X-aws-proxy-auth': tokenStr },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r || !r.ok) return { statusCode: 502, body: { error: 'sandbox unreachable' } };
  const jb = (await r.json().catch(() => ({}))) as any;
  const defaults = jb?.defaults ?? {};
  const out: Array<{ provider: string; model: string }> = [];
  for (const [pid, p] of Object.entries((jb?.providers ?? {}) as Record<string, any>)) {
    for (const m of (p as any)?.models ?? []) out.push({ provider: String(pid), model: String(m) });
  }
  // Thread default mirrors startMemberRun routing: explicit taskId+role and
  // the picker can name Auto truthfully per thread.
  let threadDefault = { provider: String(defaults.provider ?? 'meta'), model: String(defaults.model ?? '') };
  const taskId = String(params?.taskId ?? '');
  const role = String(params?.role ?? '').toLowerCase();
  if (taskId && role) {
    const task = await getTask(taskId).catch(() => null);
    const leadRole = task && Array.isArray(task.roster) && task.roster.length > 0 ? String(task.roster[0].role) : '';
    if (leadRole && role !== leadRole) {
      threadDefault = { provider: 'meta', model: 'muse-spark-1.3-contributor' };
    }
  }
  return { statusCode: 200, body: { defaults, models: out, threadDefault } };
}

/** Guest share links: the renter's customers talk with no wallet.
 * The link id IS the credential (unguessable uuid) — validate the rental is
 * working with time left, then mint exactly like an owner Talk. */
export async function handleGuestVoiceToken(params: Record<string, string | undefined>) {
  const linkId = String(params.linkId ?? '');
  if (!linkId) return { statusCode: 400, body: { error: 'needs ?linkId=' } };
  try {
    const { findTaskByGuestLink } = await import('../a2a/store');
    const task: any = await findTaskByGuestLink(linkId);
    if (!task) return { statusCode: 404, body: { error: 'unknown or expired link' } };
    const { ensureVoiceEngine, mintVoiceToken } = await import('../voice');
    const ensured = await ensureVoiceEngine(task.taskId, task.buyer);
    if (!ensured) return { statusCode: 409, body: { error: 'voice unavailable right now' } };
    const token = await mintVoiceToken(ensured.engineId);
    return { statusCode: 200, body: { token, engineId: ensured.engineId, maxDurationSeconds: ensured.maxDurationSeconds } };
  } catch (e) {
    console.error('[voice] guest token failed:', e instanceof Error ? e.message : String(e));
    return { statusCode: 502, body: { error: 'voice setup failed - try again' } };
  }
}

/** Talk UI flush — browser-kept call turns land in the concierge thread
 * history (kind 'voice') so the crew and its memory tools can see them.
 * Best-effort relay: failures are 502s the client silently ignores. */
async function relayVoiceTurns(
  task: any,
  owner: string,
  callId: string,
  turns: Array<{ vid?: string; who?: string; text?: string; at?: string }>,
): Promise<{ statusCode: number; body: any }> {
  if (!callId || turns.length === 0) return { statusCode: 400, body: { error: 'needs { callId, turns[] }' } };
  const role = String(task.roster?.[0]?.role ?? 'concierge').toLowerCase();
  const sb = await resolveSandboxVm(owner.toLowerCase()).catch(() => null);
  if (!sb) return { statusCode: 502, body: { error: 'sandbox unreachable' } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const cid = `rent:${task.taskId}#${role}`;
  const payload = {
    turns: turns.slice(0, 200).map((t, i) => ({
      vid: `${callId}:${typeof t.vid === 'string' && t.vid ? t.vid : i}`,
      role: t.who === 'aria' ? 'assistant' : 'user',
      text: String(t.text ?? '').slice(0, 2000),
      at: t.at,
    })),
  };
  try {
    const res = await fetch(`https://${sb.endpoint}/history/${encodeURIComponent(cid)}`, {
      method: 'POST',
      headers: { 'X-aws-proxy-auth': tokenStr, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const out: any = await res.json().catch(() => ({}));
    if (!res.ok) return { statusCode: 502, body: { error: 'history append failed' } };
    return { statusCode: 200, body: { ok: true, appended: out.appended ?? 0, skipped: out.skipped ?? 0 } };
  } catch (e) {
    return { statusCode: 502, body: { error: `history append failed: ${e instanceof Error ? e.message : String(e)}` } };
  }
}

/** POST /rent/io/voice/transcript (session-authed, buyer only). */
export async function handleVoiceTranscript(address: string, body: any) {
  const owner = address.toLowerCase();
  const taskId = String(body?.taskId ?? '');
  if (!taskId) return { statusCode: 400, body: { error: 'needs { taskId, callId, turns[] }' } };
  const { getTask } = await import('../a2a/store');
  const task: any = await getTask(taskId).catch(() => null);
  if (!task || !task.buyer || String(task.buyer).toLowerCase() !== owner) {
    return { statusCode: 404, body: { error: 'unknown rental' } };
  }
  if (task.status !== 'working') return { statusCode: 409, body: { error: 'rental is not live' } };
  return relayVoiceTurns(task, owner, String(body?.callId ?? ''), body?.turns);
}

/** POST /rent/io/voice/guest-transcript (public, linkId credential). */
export async function handleGuestVoiceTranscript(body: any) {
  const linkId = String(body?.linkId ?? '');
  if (!linkId) return { statusCode: 400, body: { error: 'needs { linkId, callId, turns[] }' } };
  const { findTaskByGuestLink } = await import('../a2a/store');
  const task: any = await findTaskByGuestLink(linkId).catch(() => null);
  if (!task) return { statusCode: 404, body: { error: 'unknown or expired link' } };
  return relayVoiceTurns(task, String(task.buyer), String(body?.callId ?? ''), body?.turns);
}
/** GET /rent/io/voice/guest-config?linkId= (public): team display + greeting
 * for the guest page. No secrets, no transcript. */
export async function handleGuestVoiceConfig(params: Record<string, string | undefined>) {
  const linkId = String(params.linkId ?? '');
  if (!linkId) return { statusCode: 400, body: { error: 'needs ?linkId=' } };
  const { findTaskByGuestLink } = await import('../a2a/store');
  const task: any = await findTaskByGuestLink(linkId).catch(() => null);
  if (!task) return { statusCode: 404, body: { error: 'unknown or expired link' } };
  let teamName = task.quote?.displayName ?? 'Voice Crew';
  try {
    const { resolveTeamFor } = await import('../teamStore');
    teamName = (await resolveTeamFor(task.teamId, task.buyer)).display;
  } catch { /* keep snapshot */ }
  const greeting =
    typeof task.voiceConfig?.greeting === 'string' && task.voiceConfig.greeting.trim()
      ? task.voiceConfig.greeting.trim().slice(0, 200)
      : null;
  const funded = Number(task?.quote?.fundedSeconds ?? 0) || 0;
  const since = task?.workingSince ? Date.parse(task.workingSince) : NaN;
  const elapsed = Number.isFinite(since) ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0;
  return {
    statusCode: 200,
    body: { team: teamName, greeting, minutesLeft: Math.max(0, Math.round((funded - elapsed) / 60)), status: task.status },
  };
}

/** POST /rent/io/voice/guest-link?taskId= (session-authed, buyer only):
 * create (or rotate) the guest share link. Returns the link id. */
export async function handleGuestLinkCreate(address: string, params: Record<string, string | undefined>) {
  const owner = address.toLowerCase();
  const taskId = String(params.taskId ?? '');
  const { randomUUID } = await import('node:crypto');
  const { getTask, touchTask } = await import('../a2a/store');
  const task: any = await getTask(taskId).catch(() => null);
  if (!task || !task.buyer || String(task.buyer).toLowerCase() !== owner) {
    return { statusCode: 404, body: { error: 'unknown rental' } };
  }
  if (task.status !== 'working') {
    return { statusCode: 409, body: { error: 'rentals share links only while working' } };
  }
  const linkId = randomUUID();
  await touchTask(taskId, { guestLinkId: linkId });
  return { statusCode: 200, body: { linkId } };
}

/** DELETE /rent/io/voice/guest-link?taskId= (session-authed, buyer only): revoke. */
export async function handleGuestLinkDelete(address: string, params: Record<string, string | undefined>) {
  const owner = address.toLowerCase();
  const taskId = String(params.taskId ?? '');
  const { getTask, touchTask } = await import('../a2a/store');
  const task: any = await getTask(taskId).catch(() => null);
  if (!task || !task.buyer || String(task.buyer).toLowerCase() !== owner) {
    return { statusCode: 404, body: { error: 'unknown rental' } };
  }
  await touchTask(taskId, { guestLinkId: null });
  return { statusCode: 200, body: { ok: true } };
}

/** GET /rent/io/voice/guest-link?taskId= (session-authed, buyer only): current link id or null. */
export async function handleGuestLinkGet(address: string, params: Record<string, string | undefined>) {
  const owner = address.toLowerCase();
  const taskId = String(params.taskId ?? '');
  const { getTask } = await import('../a2a/store');
  const task: any = await getTask(taskId).catch(() => null);
  if (!task || !task.buyer || String(task.buyer).toLowerCase() !== owner) {
    return { statusCode: 404, body: { error: 'unknown rental' } };
  }
  return { statusCode: 200, body: { linkId: (task.guestLinkId as string | null) ?? null } };
}

/** GET /rent/io/voice/token?taskId= (session-authed): mint a browser WebRTC
 * conversation token for this rental's Speech Engine. Creates/refreshes the
 * engine on first Talk (idempotent afterwards) and ensures the VM has it
 * attached. The key never leaves the server. */
export async function handleVoiceToken(address: string, params: Record<string, string | undefined>) {
  const owner = address.toLowerCase();
  const taskId = String(params.taskId ?? '');
  if (!taskId) return { statusCode: 400, body: { error: 'needs ?taskId=' } };
  const speakers = String(params.speakers ?? '')
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 6);
  try {
    const { ensureVoiceEngine, mintVoiceToken } = await import('../voice');
    const ensured = await ensureVoiceEngine(taskId, owner, speakers.length > 0 ? { speakRoles: speakers } : undefined);
    if (!ensured) {
      return { statusCode: 409, body: { error: 'voice needs a working rental with a live sandbox' } };
    }
    const token = await mintVoiceToken(ensured.engineId);
    return { statusCode: 200, body: { token, engineId: ensured.engineId, maxDurationSeconds: ensured.maxDurationSeconds } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ELEVENLABS_API_KEY is not configured/.test(msg)) {
      return { statusCode: 503, body: { error: 'voice is not configured yet' } };
    }
    console.error(`[voice] token failed: ${msg}`);
    return { statusCode: 502, body: { error: 'voice setup failed - try again' } };
  }
}

/** Run gates (approvals/questions) for one parked member run. The VM lists
 * are per-sandbox (one wallet = one sandbox), so filter by runId — a thread
 * only ever resolves its own run's gates. */
async function fetchVmGates(
  endpoint: string,
  tokenStr: string,
): Promise<{ approvals: any[]; questions: any[]; botRequests: any[] }> {
  const H = { 'X-aws-proxy-auth': tokenStr };
  const [a, q, br] = await Promise.all([
    fetch(`https://${endpoint}/approvals`, { headers: H, signal: AbortSignal.timeout(20_000) }).catch(() => null),
    fetch(`https://${endpoint}/questions`, { headers: H, signal: AbortSignal.timeout(20_000) }).catch(() => null),
    fetch(`https://${endpoint}/bot-requests`, { headers: H, signal: AbortSignal.timeout(20_000) }).catch(() => null),
  ]);
  const approvals = a && a.ok ? (((await a.json().catch(() => ({}))) as any).approvals ?? []) : [];
  const questions = q && q.ok ? (((await q.json().catch(() => ({}))) as any).questions ?? []) : [];
  const botRequests = br && br.ok ? (((await br.json().catch(() => ({}))) as any).requests ?? []) : [];
  return { approvals, questions, botRequests };
}

/** GET /rent/io/crew/gates?taskId=&role=&runId=: pending approvals +
 * questions parked on this run. Empty = nothing to resolve (keep polling). */
export async function handleCrewGates(address: string, params: Record<string, string | undefined>) {
  const owner = address.toLowerCase();
  const taskId = String(params.taskId ?? '');
  const role = String(params.role ?? '').toLowerCase();
  const runId = String(params.runId ?? '');
  const task = await getTask(taskId);
  if (!task || !task.buyer || task.buyer.toLowerCase() !== owner) {
    return { statusCode: 404, body: { error: 'unknown thread' } };
  }
  if (!(task.roster ?? []).some((m) => m.role === role)) {
    return { statusCode: 404, body: { error: `no member '${role}' on this rental` } };
  }
  if (!runId) return { statusCode: 400, body: { error: 'needs ?runId=' } };
  const sb = await resolveSandboxVm(owner);
  if (!sb) return { statusCode: 404, body: { error: 'no live sandbox' } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const { approvals, questions, botRequests } = await fetchVmGates(sb.endpoint, tokenStr);
  return {
    statusCode: 200,
    body: {
      botRequests: botRequests
        .filter((g) => String(g?.runId ?? '') === runId)
        .map((g) => {
          const req = (g?.request ?? {}) as any;
          return {
            id: String(g.id),
            kind: String(req?.kind ?? g?.kind ?? 'create'),
            name: String(req?.name ?? ''),
            role: String(req?.role ?? ''),
            description: String(req?.description ?? req?.botDescription ?? '').slice(0, 500),
            requestedAt: String(g.requestedAt ?? ''),
          };
        }),
      approvals: approvals
        .filter((g) => String(g?.runId ?? '') === runId)
        .map((g) => ({ id: String(g.id), permission: String(g.permission ?? ''), target: String(g.target ?? '').slice(0, 500), requestedAt: String(g.requestedAt ?? '') })),
      questions: questions
        .filter((g) => String(g?.runId ?? '') === runId)
        .map((g) => ({
          id: String(g.id),
          requestedAt: String(g.requestedAt ?? ''),
          questions: ((g.questions ?? []) as any[]).map((qq) => ({
            header: String(qq.header ?? ''),
            question: String(qq.question ?? ''),
            options: ((qq.options ?? []) as any[]).map((o) => ({ label: String(o.label ?? ''), description: String(o.description ?? '') })),
          })),
        })),
    },
  };
}

async function resolveVmGate(
  address: string,
  kind: 'approvals' | 'questions' | 'bot-requests',
  id: string,
  body: any,
): Promise<{ statusCode: number; body: Record<string, any> }> {
  const owner = address.toLowerCase();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return { statusCode: 400, body: { error: 'bad gate id' } };
  if (kind === 'approvals') {
    const d = String(body?.decision ?? '');
    if (d !== 'approve' && d !== 'reject' && d !== 'approve-all') {
      return { statusCode: 400, body: { error: 'decision must be approve, reject, or approve-all' } };
    }
  } else if (kind === 'questions') {
    if (!Array.isArray(body?.answers)) return { statusCode: 400, body: { error: 'answers must be string[][]' } };
  } else {
    const d = String(body?.decision ?? '');
    if (d !== 'confirm' && d !== 'cancel') {
      return { statusCode: 400, body: { error: 'decision must be confirm or cancel' } };
    }
  }
  const sb = await resolveSandboxVm(owner);
  if (!sb) return { statusCode: 404, body: { error: 'no live sandbox' } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  // Ownership: only resolve gates parked on this buyer's rentals. The VM
  // lists carry runIds — verify one belongs to an owned task thread first.
  const { approvals, questions } = await fetchVmGates(sb.endpoint, tokenStr);
  const mine = kind === 'approvals' ? approvals : questions;
  if (!mine.some((g) => String(g?.id ?? '') === id)) {
    return { statusCode: 404, body: { error: 'unknown gate' } };
  }
  const r = await fetch(`https://${sb.endpoint}/${kind}/${id}`, {
    method: 'POST',
    headers: { 'X-aws-proxy-auth': tokenStr, 'content-type': 'application/json' },
    body: JSON.stringify(
      kind === 'approvals'
        ? { decision: body.decision }
        : kind === 'questions'
          ? { answers: body.answers }
          : { decision: body.decision },
    ),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r) return { statusCode: 502, body: { error: 'sandbox unreachable' } };
  if (!r.ok) return { statusCode: 502, body: { error: 'gate resolve failed' } };
  return { statusCode: 200, body: { ok: true } };
}

/** POST /rent/io/crew/gates/approvals/:id {decision} */
export async function handleApprovalResolve(address: string, id: string, body: any) {
  return resolveVmGate(address, 'approvals', id, body);
}

/** POST /rent/io/crew/gates/questions/:id {answers} */
export async function handleQuestionAnswer(address: string, id: string, body: any) {
  return resolveVmGate(address, 'questions', id, body);
}

/** POST /rent/io/crew/gates/bot-requests/:id {decision: confirm|cancel} */
export async function handleBotRequestAnswer(address: string, id: string, body: any) {
  return resolveVmGate(address, 'bot-requests', id, body);
}

export async function handleSandboxShutdown(address: string, body: any) {
  const taskId = String(body?.taskId ?? '');
  if (!taskId) {
    // No task → per-wallet sandbox (option B). PLATFORM SUSPEND KILLS VMS
    // (observed repeatedly: SuspendMicrovm → TERMINATED, no hook, no backup),
    // so this route is flush-only: trigger the VM-side backup, keep it live.
    const sb = await resolveSandboxVm(address.toLowerCase());
    if (!sb) {
      return { statusCode: 404, body: { error: 'no sandbox' } };
    }
    let tokenStr: string;
    try {
      tokenStr = await vmToken(sb.vmId);
    } catch {
      return { statusCode: 502, body: { error: 'sandbox auth failed' } };
    }
    try {
      const res = await fetch(`https://${sb.endpoint}/hooks/suspend`, {
        method: 'POST',
        headers: { 'X-aws-proxy-auth': tokenStr, 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(120_000),
      });
      const out: any = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) {
        return { statusCode: 502, body: { error: 'backup flush failed', detail: out } };
      }
      return { statusCode: 200, body: { ok: true, state: 'live', flushed: out } };
    } catch (e) {
      return { statusCode: 502, body: { error: `backup flush failed: ${e instanceof Error ? e.message : String(e)}` } };
    }
  }
  const task = await getTask(taskId);
  if (!task || !task.buyer || task.buyer.toLowerCase() !== address.toLowerCase()) {
    return { statusCode: 404, body: { error: 'unknown sandbox' } };
  }
  if (!task.vm?.vmId || task.vm.terminatedAt) {
    return { statusCode: 409, body: { error: 'sandbox is not running' } };
  }
  if (task.vm.suspendedAt) return { statusCode: 200, body: { ok: true, state: 'suspended' } };
  const note = await suspendVm(task);
  return { statusCode: 200, body: { ok: true, state: 'suspended', note } };
}

export async function handleSandboxTerminate(address: string, body: any) {
  // Async by design: the backup flush can outlive the 29s gateway clock (a
  // timed-out Lambda returns no CORS headers — browsers read that as a CORS
  // failure). The route validates + 202s immediately; the sandbox fn runs
  // flush-then-terminate in the background. Poll status for convergence.
  const { invokeSandboxFn } = await import('../a2a/clients');
  const taskId = String(body?.taskId ?? '');
  if (!taskId) {
    // No task → per-wallet sandbox (option B). Record stays for history.
    const rec = await getSandbox(address.toLowerCase()).catch(() => null);
    if (!rec?.vm?.vmId || rec.vm.terminatedAt) {
      return { statusCode: 404, body: { error: 'no sandbox' } };
    }
    await invokeSandboxFn('terminate-sandbox', { wallet: address.toLowerCase() });
    return { statusCode: 202, body: { ok: true, state: 'terminating', note: 'backup flush + terminate running in background' } };
  }
  const task = await getTask(taskId);
  if (!task || !task.buyer || task.buyer.toLowerCase() !== address.toLowerCase()) {
    return { statusCode: 404, body: { error: 'unknown rental' } };
  }
  if (task.status === 'ended' || task.endedAt) {
    return { statusCode: 200, body: { ok: true, state: 'ended', note: 'already ended' } };
  }
  // Option-B rentals have no per-task VM (crew runs in the wallet sandbox),
  // so ending is bookkeeping: the clock stops, chat hard-stops, the one-team
  // slot frees. Escrow stays locked per job until expiry (claimRefund path).
  // Ending is recorded NOW (clock stops at request time); the VM kill runs
  // in the background.
  task.status = 'ended';
  task.endedAt = new Date().toISOString();
  await putA2aTask(task);
  if ((task as any).voiceEngineId) {
    const { teardownVoice } = await import('../voice');
    await teardownVoice(taskId, address.toLowerCase()).catch(() => {});
  }
  if (!task.vm?.vmId || task.vm.terminatedAt) {
    return { statusCode: 200, body: { ok: true, state: 'ended', note: 'rental ended (no task VM to terminate)' } };
  }
  await invokeSandboxFn('terminate-task-vm', { task_id: taskId });
  return { statusCode: 202, body: { ok: true, state: 'terminated', note: 'rental ended; VM backup flush + terminate running in background' } };
}

/** POST /rent/sandbox/boot (session-authed): accept + provision async (poll status). */
export async function handleSandboxBoot(address: string) {
  const owner = address.toLowerCase();
  const rec = await getSandbox(owner).catch(() => null);
  if (rec?.vm?.vmId && rec.vm.endpoint && !rec.vm.suspendedAt && !rec.vm.terminatedAt) {
    // Records go stale (out-of-band terminate) — verify before trusting.
    let running = false;
    try {
      const got: any = await microvmsClient.send(new GetMicrovmCommand({ microvmIdentifier: rec.vm.vmId }));
      if (got.endpoint && /running/i.test(JSON.stringify(got.state))) {
        running = true;
        if (got.endpoint !== rec.vm.endpoint) {
          rec.vm.endpoint = got.endpoint;
          await putSandbox(rec).catch(() => {});
        }
      }
    } catch {
      running = false;
    }
    if (running) {
      return { statusCode: 200, body: { state: 'live', computerId: rec.computerId } };
    }
    rec.vm.terminatedAt = new Date().toISOString();
    delete rec.vm.suspendedAt;
    rec.status = 'terminated';
    await putSandbox(rec).catch(() => {});
  }
  // Fresh boot in flight → don't double-invoke. Stale boot (>5 min, e.g. a
  // crashed provision) → re-invoke; the handler provisions when no VM exists.
  if (rec && rec.status === 'booting' && Date.now() - new Date(rec.updatedAt).getTime() < 5 * 60_000) {
    return { statusCode: 202, body: { accepted: true, state: 'booting' } };
  }
  await invokeSandboxFn({ internal: true, action: 'boot-sandbox', wallet: owner });
  return { statusCode: 202, body: { accepted: true, state: 'booting' } };
}

/** GET /rent/sandbox/status (session-authed). Verifies liveness via
 * GetMicrovm — records go stale when the platform reaps VMs, and every
 * downstream reader (history, preview, token) trusts this record. A dead
 * VM is marked terminated here so callers fail fast instead of looping. */
export async function handleSandboxStatus(address: string) {
  const rec = await getSandbox(address.toLowerCase()).catch(() => null);
  if (!rec) return { statusCode: 200, body: { state: 'none' } };
  if (rec.vm?.vmId && rec.vm.endpoint && !rec.vm.terminatedAt) {
    let running = false;
    try {
      const got: any = await microvmsClient.send(new GetMicrovmCommand({ microvmIdentifier: rec.vm.vmId }));
      if (got.endpoint && /running/i.test(JSON.stringify(got.state))) {
        running = true;
        if (got.endpoint !== rec.vm.endpoint) {
          rec.vm.endpoint = got.endpoint;
          await putSandbox(rec).catch(() => {});
        }
      }
    } catch {
      running = false;
    }
    if (!running) {
      rec.vm.terminatedAt = new Date().toISOString();
      delete rec.vm.suspendedAt;
      rec.status = 'terminated';
      await putSandbox(rec).catch(() => {});
    }
  }
  return {
    statusCode: 200,
    body: {
      state: rec.vm?.terminatedAt
        ? 'terminated'
        : rec.vm?.suspendedAt
          ? 'suspended'
          : rec.vm?.vmId
            ? 'live'
            : rec.status,
      computerId: rec.computerId,
      vmId: rec.vm?.vmId ?? null,
      vmLive: !!rec.vm?.vmId && !!rec.vm?.endpoint && !rec.vm?.suspendedAt && !rec.vm?.terminatedAt,
      vmSuspended: !!rec.vm?.suspendedAt && !rec.vm?.terminatedAt,
      bootedAt: rec.vm?.bootedAt ?? null,
      updatedAt: rec.updatedAt,
    },
  };
}

/** POST /rent/sandbox/token (session-authed): mint a short-lived VM auth
 * token for the browser terminal (wss://{endpoint}/term). Live VM only. */
export async function handleSandboxToken(address: string) {
  const owner = address.toLowerCase();
  const rec = await getSandbox(owner).catch(() => null);
  if (!rec?.vm?.vmId || !rec.vm.endpoint || rec.vm.suspendedAt || rec.vm.terminatedAt) {
    return { statusCode: 404, body: { error: 'no live sandbox — boot one first' } };
  }
  try {
    const token = await vmToken(rec.vm.vmId);
    return { statusCode: 200, body: { authToken: token, endpoint: rec.vm.endpoint } };
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
}

/** POST /rent/sandbox/resume (session-authed): async, poll status. */

export async function handleSandboxResume(address: string) {
  const owner = address.toLowerCase();
  const rec = await getSandbox(owner).catch(() => null);
  if (!rec?.vm?.vmId || rec.vm.terminatedAt) {
    return { statusCode: 404, body: { error: 'no sandbox — boot one first' } };
  }
  if (!rec.vm.suspendedAt) return { statusCode: 200, body: { ok: true, state: 'live' } };
  await invokeSandboxFn({ internal: true, action: 'resume-sandbox', wallet: owner });
  return { statusCode: 202, body: { accepted: true, state: 'resuming' } };
}

// ---------- Signed sandbox preview (browser access without a bearer) ----------
// Navigations can't attach the session JWT, so preview/dev links carry an
// HMAC token in query: /rent/preview/<scope>/<target...>?preview=<exp>.<ownerB64>.<hex>
// Scope binding: preview tokens only fetch /preview/<target>/..., dev tokens
// only /dev/?port=. Subresources (absolute asset paths drop the query) reuse
// the wf_preview cookie planted on the first signed response. Key derived
// from SESSION_SECRET (domain-separated); no extra secret to manage.

const PREVIEW_TTL_MS = 15 * 60 * 1000;

function previewKey(): Buffer {
  const secret = process.env.SESSION_SECRET ?? '';
  if (!secret) throw new Error('Server misconfigured: SESSION_SECRET is not set');
  return createHmac('sha256', secret).update('crewtopia-preview-v1').digest();
}

function signPreview(owner: string, scope: string, target: string, exp: number): string {
  return createHmac('sha256', previewKey()).update(`${owner}.${scope}.${target}.${exp}`).digest('hex');
}

function verifyPreview(owner: string, scope: string, target: string, token: string): boolean {
  const parts = (token ?? '').split('.');
  if (parts.length !== 3) return false;
  const exp = Number(parts[0]);
  const sig = parts[2];
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  const want = signPreview(owner, scope, target, exp);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(want, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function previewTokenFrom(event: any): string | null {
  const qs = event.queryStringParameters ?? {};
  if (typeof qs.preview === 'string' && qs.preview) return qs.preview;
  const cookie = String(event.headers?.Cookie ?? event.headers?.cookie ?? '');
  const m = /(?:^|;\s*)wf_preview=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

function cleanTarget(raw: string): string | null {
  const t = String(raw ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (t === '') return '';
  const segs = t.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return null;
  if (t.length > 256) return null;
  return t;
}

/** POST /rent/preview/token (session-authed): mint a browser-openable preview URL. */
export async function handlePreviewToken(address: string, body: any) {
  const owner = address.toLowerCase();
  const scope = body?.scope === 'dev' ? 'dev' : 'preview';
  const port = Number(body?.port ?? 5173);
  if (scope === 'dev' && !(port > 0 && port < 65536)) {
    return { statusCode: 400, body: { error: 'port must be 1-65535' } };
  }
  const target = scope === 'dev' ? '' : cleanTarget(body?.target ?? '');
  if (target === null) return { statusCode: 400, body: { error: 'bad target' } };
  const sb = await resolveSandboxVm(owner);
  if (!sb) {
    return { statusCode: 404, body: { error: 'no live sandbox for this wallet' } };
  }
  const exp = Date.now() + PREVIEW_TTL_MS;
  const ownerB64 = Buffer.from(owner).toString('base64url');
  const sig = signPreview(owner, scope, target, exp);
  const token = `${exp}.${ownerB64}.${sig}`;
  const path =
    scope === 'dev'
      ? `/rent/preview/dev/?port=${port}&preview=${encodeURIComponent(token)}`
      : `/rent/preview/preview/${target ? `${target}/` : ''}?preview=${encodeURIComponent(token)}`;
  return { statusCode: 200, body: { path, preview: token, exp } };
}

/** Workspace file browser (Library tab source). Sandbox-scoped; the VM
 * jails paths to the workspace. Query: ?path= (default ''). */
export async function handleCrewFiles(address: string, params: Record<string, string | undefined>) {
  const owner = address.toLowerCase();
  const rel = String(params.path ?? '');
  if (rel.includes('..')) return { statusCode: 400, body: { error: 'bad path' } };
  const sb = await resolveSandboxVm(owner);
  if (!sb) return { statusCode: 404, body: { error: 'no live sandbox — boot one first' } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const r = await fetch(`https://${sb.endpoint}/files?path=${encodeURIComponent(rel)}`, {
    headers: { 'X-aws-proxy-auth': tokenStr },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r) return { statusCode: 502, body: { error: 'sandbox unreachable' } };
  const jb = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) return { statusCode: r.status, body: { error: String(jb?.error ?? 'list failed').slice(0, 200) } };
  const entries = ((jb?.entries ?? []) as any[]).map((e) => ({
    name: String(e?.name ?? ''),
    dir: !!e?.dir,
    size: Number(e?.size ?? 0) || 0,
    mtime: Number(e?.mtime ?? 0) || 0,
  }));
  return { statusCode: 200, body: { path: String(jb?.path ?? rel), entries } };
}

/** Download one workspace file (Library tab). Binary — the index
 * returns it base64-encoded, bypassing the JSON envelope. */
export async function handleCrewFileDownload(address: string, params: Record<string, string | undefined>) {
  const owner = address.toLowerCase();
  const rel = String(params.path ?? '');
  if (!rel || rel.includes('..')) return { statusCode: 400, body: { error: 'needs ?path=' } };
  const sb = await resolveSandboxVm(owner);
  if (!sb) return { statusCode: 404, body: { error: 'no live sandbox — boot one first' } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const r = await fetch(`https://${sb.endpoint}/files/download?path=${encodeURIComponent(rel)}`, {
    headers: { 'X-aws-proxy-auth': tokenStr },
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!r || !r.ok) return { statusCode: 502, body: { error: 'sandbox unreachable' } };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 10 * 1024 * 1024) return { statusCode: 413, body: { error: 'file too large' } };
  const name = rel.split('/').pop() ?? 'download';
  return { statusCode: 200, binary: buf, fileName: name };
}

/** GET /rent/io/voice/status (session-authed): is a Speech Engine
 * attached on this wallet's sandbox, and which one? */
export async function handleVoiceStatus(address: string) {
  const owner = address.toLowerCase();
  const sb = await resolveSandboxVm(owner);
  if (!sb) return { statusCode: 200, body: { attached: false, engineId: null, sandboxLive: false } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const r = await fetch(`https://${sb.endpoint}/voice-chat`, {
    headers: { 'X-aws-proxy-auth': tokenStr },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r) return { statusCode: 200, body: { attached: false, engineId: null, sandboxLive: true, route: false } };
  if (r.status === 404) return { statusCode: 200, body: { attached: false, engineId: null, sandboxLive: true, route: false } };
  if (!r.ok) return { statusCode: 200, body: { attached: false, engineId: null, sandboxLive: true, route: true } };
  const jb = (await r.json().catch(() => ({}))) as any;
  return {
    statusCode: 200,
    body: { attached: !!jb.attached, engineId: jb.engineId ?? null, taskId: jb.taskId ?? null, sandboxLive: true, route: true },
  };
}

/** POST /rent/io/crew/context/compact?taskId=&role=: summarize the head,
 * keep the tail. Transcript stays readable. */
export async function handleCrewContextCompact(address: string, params: Record<string, string | undefined>) {
  const owner = address.toLowerCase();
  const taskId = String(params.taskId ?? '');
  const role = String(params.role ?? '').toLowerCase();
  const task = await getTask(taskId);
  if (!task || !task.buyer || task.buyer.toLowerCase() !== owner) {
    return { statusCode: 404, body: { error: 'unknown thread' } };
  }
  if (!(task.roster ?? []).some((m) => m.role === role)) {
    return { statusCode: 404, body: { error: `no member '${role}' on this rental` } };
  }
  const sb = await resolveSandboxVm(owner);
  if (!sb) return { statusCode: 404, body: { error: 'no live sandbox' } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const r = await fetch(`https://${sb.endpoint}/context/${encodeURIComponent(`rent:${taskId}#${role}`)}`, {
    method: 'POST',
    headers: { 'X-aws-proxy-auth': tokenStr, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(120_000),
  }).catch(() => null);
  if (!r || !r.ok) return { statusCode: 502, body: { error: 'sandbox unreachable' } };
  const jb = (await r.json().catch(() => ({}))) as any;
  return {
    statusCode: 200,
    body: {
      compacted: true,
      tokens: Number(jb?.tokens ?? 0),
      limit: Number(jb?.limit ?? 0),
      pct: Number(jb?.pct ?? 0),
      note: String(jb?.note ?? jb?.summary ?? ''),
    },
  };
}

const MCP_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LB_URL = 'https://livingbrain.fernmcp.dev/livingbrain';

/** Shared VM JSON relay: session-authed owner → own sandbox only. */
async function relayToVm(address: string, method: string, path: string, payload?: unknown) {
  const owner = String(address).toLowerCase();
  const sb = await resolveSandboxVm(owner).catch(() => null);
  if (!sb) return { statusCode: 409, body: { error: 'boot your sandbox first' } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  try {
    const res = await fetch(`https://${(sb as any).endpoint}${path}`, {
      method,
      headers: { 'X-aws-proxy-auth': tokenStr, 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    return { statusCode: res.status, body: data };
  } catch {
    return { statusCode: 502, body: { error: 'sandbox unreachable' } };
  }
}

const SKILL_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;

/** POST /rent/io/teams/feedback (session-authed): record an app-submitted
 * onchain rating. Body: { taskId, tx, stars }. The task must belong to the
 * buyer and be a static crew (customs share Dev's agent — no misattribution).
 * Idempotent per tx. The chain stays source of truth; this is the readable
 * index the landing page shows (public RPCs can't scan registry events). */
const FEEDBACK_TEAMS = new Set(['dev-crew', 'voice-crew']);
export async function handleFeedbackSubmit(address: string, body: any) {
  const owner = address.toLowerCase();
  const taskId = String(body?.taskId ?? '');
  const tx = String(body?.tx ?? '').toLowerCase();
  const stars = Math.max(1, Math.min(5, Math.round(Number(body?.stars ?? 0))));
  if (!taskId || !/^0x[0-9a-f]{64}$/.test(tx) || !stars) {
    return { statusCode: 400, body: { error: 'need taskId, 0x tx hash, stars 1-5' } };
  }
  const task: any = await getTask(taskId).catch(() => null);
  if (!task || !task.buyer || String(task.buyer).toLowerCase() !== owner) {
    return { statusCode: 404, body: { error: 'unknown rental' } };
  }
  const teamId = String(task.teamId ?? 'dev-crew');
  if (!FEEDBACK_TEAMS.has(teamId)) {
    return { statusCode: 400, body: { error: 'only Dev and Voice crews take onchain feedback' } };
  }
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const table = process.env.FEEDBACK_TABLE ?? '';
  if (!table) return { statusCode: 503, body: { error: 'feedback tally not configured' } };
  await ddb.send(new PutCommand({
    TableName: table,
    Item: { teamId, tx, stars, buyer: owner, taskId, at: new Date().toISOString() },
    ConditionExpression: 'attribute_not_exists(tx)',
  })).catch((e: any) => {
    if (e?.name !== 'ConditionalCheckFailedException') throw e;
  });
  return { statusCode: 200, body: { ok: true } };
}

/** GET /rent/io/teams/feedback?teamId= (public): app-submitted ratings tally. */
export async function handleFeedbackList(params: Record<string, string | undefined>) {
  const teamId = String(params.teamId ?? '');
  if (!FEEDBACK_TEAMS.has(teamId)) {
    return { statusCode: 400, body: { error: 'unknown team' } };
  }
  const { DynamoDBDocumentClient, QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const table = process.env.FEEDBACK_TABLE ?? '';
  if (!table) return { statusCode: 503, body: { error: 'feedback tally not configured' } };
  const out: any = await ddb.send(new QueryCommand({
    TableName: table,
    KeyConditionExpression: 'teamId = :t',
    ExpressionAttributeValues: { ':t': teamId },
  })).catch(() => ({ Items: [] }));
  const items = (out.Items ?? []) as Array<{ stars?: number; tx?: string; at?: string }>;
  const stars = items.map((i) => Number(i.stars ?? 0)).filter((s) => s >= 1 && s <= 5);
  const avg = stars.length ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10 : 0;
  return {
    statusCode: 200,
    body: {
      teamId,
      count: stars.length,
      avg,
      ratings: items.map((i) => ({ stars: i.stars, tx: i.tx, at: i.at })).slice(0, 50),
    },
  };
}

/** POST /rent/io/skills (session-authed): { op, name?, source?, overwrite? }.
 * list|remove as before; resolve previews a source; install saves it after
 * the buyer confirms the preview in the UI (same gating as chat import). */
export async function handleSkillsRelay(address: string, body: any) {
  const op = String(body?.op ?? '');
  if (op === 'list') return relayToVm(address, 'GET', '/skills');
  const name = String(body?.name ?? '');
  if (op === 'remove') {
    if (!SKILL_NAME_RE.test(name)) return { statusCode: 400, body: { error: 'bad skill name' } };
    return relayToVm(address, 'DELETE', `/skills/${name}`);
  }
  if (op === 'resolve' || op === 'install') {
    const source = String(body?.source ?? '').trim();
    if (!source || source.length > 500) return { statusCode: 400, body: { error: 'need a skill source (owner/repo[/path], GitHub URL, or SKILL.md URL)' } };
    const payload: Record<string, unknown> = { source };
    if (op === 'install' && body?.overwrite === true) payload.overwrite = true;
    return relayToVm(address, 'POST', op === 'resolve' ? '/skills/resolve' : '/skills/install', payload);
  }
  return { statusCode: 400, body: { error: 'op must be list|remove|resolve|install' } };
}

/** POST /rent/io/permissions (session-authed): { op: 'get' | 'set' | 'undo', rules? } */
export async function handlePermissionsRelay(address: string, body: any) {
  const op = String(body?.op ?? '');
  if (op === 'get') return relayToVm(address, 'GET', '/permissions');
  if (op === 'undo') return relayToVm(address, 'POST', '/permissions/undo', {});
  if (op === 'set') {
    const rules = body?.rules;
    if (!Array.isArray(rules) || rules.length > 200) {
      return { statusCode: 400, body: { error: 'rules must be an array (max 200)' } };
    }
    return relayToVm(address, 'PUT', '/permissions', { rules });
  }
  return { statusCode: 400, body: { error: 'op must be get|set|undo' } };
}

/** POST /rent/io/mcp (session-authed): relay MCP registry ops to the renter's
 * sandbox VM. Body: { op: 'list' | 'save' | 'patch' | 'remove' | 'restart',
 * name?, url?, headers?, disabledTools? }. Only https URLs; header values are
 * never logged. VM redacts secret values (configKeys only) in list output. */
export async function handleMcpRelay(address: string, body: any) {
  const owner = address.toLowerCase();
  const op = String(body?.op ?? '');
  if (!['list', 'save', 'patch', 'remove', 'restart'].includes(op)) {
    return { statusCode: 400, body: { error: "op must be list|save|patch|remove|restart" } };
  }
  const sb = await resolveSandboxVm(owner).catch(() => null);
  if (!sb) return { statusCode: 409, body: { error: 'boot your sandbox first' } };
  let tokenStr: string;
  try {
    tokenStr = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const callVm = async (method: string, path: string, payload?: unknown) => {
    const res = await fetch(`https://${(sb as any).endpoint}${path}`, {
      method,
      headers: { 'X-aws-proxy-auth': tokenStr, 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
  try {
    if (op === 'list') {
      const r = await callVm('GET', '/mcp');
      return { statusCode: r.status, body: r.data };
    }
    const name = String(body?.name ?? '');
    if (!MCP_NAME_RE.test(name)) {
      return { statusCode: 400, body: { error: 'bad server name (A-Za-z0-9_-, max 64)' } };
    }
    if (op === 'remove') {
      const r = await callVm('DELETE', `/mcp/${name}`);
      return { statusCode: r.status, body: r.data };
    }
    if (op === 'restart') {
      const r = await callVm('POST', `/mcp/${name}/restart`);
      return { statusCode: r.status, body: r.data };
    }
    // save | patch: strict shape — https URL, string-map headers, string[] tools.
    const cfg: Record<string, unknown> = {};
    if (body?.url !== undefined) {
      const url = String(body.url);
      if (!url.startsWith('https://') || url.length > 500) {
        return { statusCode: 400, body: { error: 'url must be https (max 500 chars)' } };
      }
      cfg.url = url;
    }
    if (body?.headers !== undefined) {
      const h = body.headers as Record<string, unknown>;
      const keys = Object.keys(h ?? {});
      if (!h || typeof h !== 'object' || keys.length > 20 || keys.some((k) => typeof h[k] !== 'string' || (h[k] as string).length > 2000)) {
        return { statusCode: 400, body: { error: 'headers must be a small string map' } };
      }
      cfg.headers = h;
    }
    if (body?.disabledTools !== undefined) {
      const dt = body.disabledTools;
      if (!Array.isArray(dt) || dt.length > 60 || dt.some((t) => typeof t !== 'string')) {
        return { statusCode: 400, body: { error: 'disabledTools must be string[]' } };
      }
      cfg.disabledTools = dt;
    }
    const r = op === 'save'
      ? await callVm('POST', '/mcp', { name, ...cfg })
      : await callVm('PATCH', `/mcp/${name}`, cfg);
    return { statusCode: r.status, body: r.data };
  } catch {
    return { statusCode: 502, body: { error: 'sandbox unreachable' } };
  }
}

const TEXTISH = /^(text\/|application\/(json|javascript|x-javascript|xml|xhtml\+xml)|image\/svg\+xml)/;

async function fetchFromVm(endpoint: string, token: string, path: string) {
  const res = await fetch(`https://${endpoint}${path}`, {
    headers: { 'X-aws-proxy-auth': token, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, contentType: res.headers.get('content-type') ?? 'application/octet-stream', buf };
}

/** GET /rent/preview/{proxy+} (token-gated, no session): proxy bytes VM → browser. */
export async function handlePreviewProxy(event: any) {
  const rawPath = String(event.path ?? '');
  const m = /^\/rent\/preview\/([^/]+)\/?(.*)$/.exec(rawPath);
  const scope = m?.[1] ?? '';
  if (scope !== 'preview' && scope !== 'dev') {
    return { statusCode: 404, body: 'unknown preview scope' };
  }
  const token = previewTokenFrom(event);
  if (!token) return { statusCode: 403, body: 'missing preview token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { statusCode: 403, body: 'bad preview token' };
  let owner = '';
  try {
    owner = Buffer.from(parts[1], 'base64url').toString('utf8').toLowerCase();
  } catch {
    return { statusCode: 403, body: 'bad preview token' };
  }
  if (!owner) return { statusCode: 403, body: 'bad preview token' };

  if (scope === 'dev') {
    const port = Number(event.queryStringParameters?.port ?? 5173);
    if (!(port > 0 && port < 65536)) return { statusCode: 400, body: 'bad port' };
    if (!verifyPreview(owner, 'dev', '', token)) return { statusCode: 403, body: 'bad preview signature' };
    const sb = await resolveSandboxVm(owner);
    if (!sb) {
      return { statusCode: 404, body: 'sandbox not running' };
    }
    const sub = String(m?.[2] ?? '').replace(/^\/+/, '');
    const vmPath = sub ? `/dev/${sub}?port=${port}` : `/dev/?port=${port}`;
    return proxyVm(sb.vmId, sb.endpoint, vmPath, token, `/rent/preview/dev/`);
  }

  // preview scope: /rent/preview/preview/<folder...>
  const rest = String(m?.[2] ?? '').replace(/^preview\/?/, '').replace(/^\/+/, '');
  const target = cleanTarget(rest.split('?')[0]);
  if (target === null) return { statusCode: 400, body: 'bad preview path' };
  if (!verifyPreview(owner, 'preview', target, token)) return { statusCode: 403, body: 'bad preview signature' };
  const sb = await resolveSandboxVm(owner);
  if (!sb) {
    return { statusCode: 404, body: 'sandbox not running' };
  }
  return proxyVm(sb.vmId, sb.endpoint, `/preview/${target}`, token, `/rent/preview/preview/${target ? `${target}/` : ''}`);
}

async function proxyVm(vmId: string, endpoint: string, vmPath: string, token: string, base: string) {
  let tokenStr: string;
  try {
    tokenStr = await vmToken(vmId);
  } catch {
    return { statusCode: 502, body: 'sandbox auth failed' };
  }
  let fetched;
  try {
    fetched = await fetchFromVm(endpoint, tokenStr, vmPath);
  } catch (e) {
    console.error(`[preview] fetch ${vmPath} failed: ${e instanceof Error ? e.message : String(e)}`);
    return { statusCode: 502, body: 'sandbox unreachable' };
  }
  console.log(`[preview] ${vmPath} -> ${fetched.status} ${fetched.contentType} ${fetched.buf.length}b`);
  const headers: Record<string, string> = {
    'Content-Type': fetched.contentType,
    // Subresource bearer: absolute asset paths drop the query, the cookie
    // keeps them working. Scoped to the preview tree, 15 min.
    'Set-Cookie': `wf_preview=${encodeURIComponent(token)}; Path=/rent/preview/; Max-Age=900; HttpOnly; Secure; SameSite=None`,
  };
  if (TEXTISH.test(fetched.contentType)) {
    let text = fetched.buf.toString('utf8');
    if (fetched.contentType.includes('text/html')) {
      // Rewrite absolute asset roots so subresources stay inside the
      // signed proxy base (absolute paths would escape to the API root).
      text = text.replace(/(src|href|action)=\"\/(?!\/)/g, `$1="${base}`);
    }
    return { statusCode: fetched.status, headers, body: text };
  }
  return {
    statusCode: fetched.status,
    headers,
    body: fetched.buf.toString('base64'),
    isBase64Encoded: true,
  };
}
