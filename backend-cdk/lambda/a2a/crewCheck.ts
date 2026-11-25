// Lazy crew supervision (option 2): runs inside web3-task-status polls —
// buyer-driven, zero idle cost. Self-throttles to ~60s per task and stays
// under ~20s wall time so the gateway never times out. Checks: crew started,
// hard-stop expiry, stalled lead run (nudge, max 3), dev preview liveness.
// When unattended supervision is needed later, this same function drops
// unchanged into a per-rental EventBridge schedule.
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { deliveryExists } from '../sandbox';
import { vmToken } from './vm';
import { setCrewRun, touchTask } from './store';
import type { StoredTask } from './types';

const lambdaClient = new LambdaClient({});
const SANDBOX_FN = process.env.SANDBOX_FN ?? '';
const CHECK_INTERVAL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_NUDGES = 3;

async function invokeSandbox(payload: unknown): Promise<void> {
  if (!SANDBOX_FN) return;
  await lambdaClient
    .send(new InvokeCommand({ FunctionName: SANDBOX_FN, InvocationType: 'Event', Payload: JSON.stringify(payload) }))
    .catch(() => null);
}

async function vmGet(endpoint: string, token: string, path: string): Promise<any | null> {
  try {
    const res = await fetch(`https://${endpoint}${path}`, {
      headers: { 'X-aws-proxy-auth': token },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

async function vmPost(endpoint: string, token: string, path: string, body: unknown): Promise<any | null> {
  try {
    const res = await fetch(`https://${endpoint}${path}`, {
      method: 'POST',
      headers: { 'X-aws-proxy-auth': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status !== 202 && res.status !== 200) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

function isDevTeam(task: StoredTask): boolean {
  return (task.teamId ?? 'dev-crew') === 'dev-crew';
}

/**
 * Run one supervision pass. Returns human-readable notes for the status
 * reply. Never throws — callers append notes best-effort.
 */
export async function maybeSupervise(task: StoredTask): Promise<string[]> {
  const notes: string[] = [];
  try {
    if (task.status !== 'working') return notes;
    const buyer = (task.buyer ?? '').toLowerCase();
    if (!buyer) return notes;
    const funded = task.quote?.fundedSeconds ?? 0;
    const since = task.workingSince ? Date.parse(task.workingSince) : NaN;
    const elapsed = Number.isFinite(since) ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0;
    if (funded > 0 && elapsed >= funded) {
      notes.push('rental window ended — extend to continue the crew');
      return notes;
    }
    const now = Date.now();
    if (task.lastCrewCheck && now - task.lastCrewCheck < CHECK_INTERVAL_MS && task.crewRuns && Object.keys(task.crewRuns).length > 0) {
      return notes;
    }
    task.lastCrewCheck = now;

    // 1. Sandbox live?
    const { resolveSandboxVm } = await import('../sandboxStore');
    let sb = await resolveSandboxVm(buyer).catch(() => null);
    if (!sb) {
      await invokeSandbox({ internal: true, action: 'boot-sandbox', wallet: buyer });
      task.lastCrewCheck = now;
      // Fix D: timestamp-only touch — never a whole-task write that could
      // wipe a concurrent starter's crewRuns.
      await touchTask(task.taskId, { lastCrewCheck: now }).catch(() => {});
      notes.push('crew sandbox booting');
      return notes;
    }

    // 2. Crew started? If no tracked runs, kick the starter and come back next poll.
    const roster = task.roster ?? [];
    const lead = roster[0];
    if (!task.crewRuns || Object.keys(task.crewRuns).length === 0) {
      if (lead) {
        await invokeSandbox({ internal: true, action: 'start-crew', taskId: task.taskId, wallet: buyer });
        notes.push(`crew starting (${lead.name} leading)`);
      }
      // No intent stamp here: the flip already stamped fresh hires, and a
      // retry loop must not keep extending the TTL forever — if kickoffs
      // keep failing, the stamp expires and the hello fallback fires.
      await touchTask(task.taskId, { lastCrewCheck: now }).catch(() => {});
      return notes;
    }

    // 3. Stall check: single events fetch per tracked run (parallel, capped).
    let token: string | null = null;
    try {
      token = await vmToken(sb.vmId);
    } catch {
      token = null;
    }
    if (token && lead) {
      const entries = Object.entries(task.crewRuns).slice(0, 4);
      const states = await Promise.all(
        entries.map(async ([role, r]) => {
          const body = await vmGet(sb!.endpoint, token!, `/runs/${encodeURIComponent(r.runId)}/events?cursor=${r.cursor ?? 0}`);
          return { role, run: r, body };
        }),
      );
      let dirty = false;
      // Fix D: collect per-role writes — applied atomically below, never a
      // whole-task put that could wipe a concurrent starter's roles.
      const roleWrites: Record<string, { runId: string; startedAt: string; nudges: number; cursor?: number; done?: boolean }> = {};
      for (const s of states) {
        if (!s.body || !Array.isArray(s.body.events)) continue;
        const evts = s.body.events as Array<{ type: string; chunk?: string; output?: string; error?: string; question?: unknown }>;
        const done = !!s.body.done;
        const rec = task.crewRuns![s.role];
        rec.cursor = typeof s.body.nextCursor === 'number' ? s.body.nextCursor : (rec.cursor ?? 0) + evts.length;
        roleWrites[s.role] = { ...rec };
        dirty = true;
        const needsInput = evts.find((e) => e.type === 'approval' || e.type === 'question');
        if (needsInput) {
          const who = roster.find((m) => m.role === s.role)?.name ?? s.role;
          notes.push(`${who} needs input — reply in this thread to continue`);
          continue;
        }
        if (!done) continue;
        rec.done = true;
        roleWrites[s.role] = { ...rec };
        // Nudge the lead when a finished run left no deliverable (dev teams:
        // mechanical DONE = zip exists). Cap nudges, then report stuck.
        if (s.role === lead.role && isDevTeam(task) && (rec.nudges ?? 0) < MAX_NUDGES) {
          const hasZip = await deliveryExists(task.taskId).catch(() => false);
          if (!hasZip) {
            const nudge =
              `Continue: the last run ended with no deliverable and nothing was delivered. ` +
              `Finish the build, run the deliver tool with task_id "${task.taskId}", share the download link, then write DONE. ` +
              `Do not restart — pick up from this thread's history.`;
            const started = await vmPost(sb!.endpoint, token!, '/task', {
              text: nudge.slice(0, 4000),
              botName: lead.name,
              roster: roster.map((m) => ({ id: m.role, name: m.name, role: m.title })),
              system: lead.brief,
              ownerId: buyer,
              conversationId: `rent:${task.taskId}#${lead.role}`,
            });
            const nid = started?.runId ?? started?.run_id ?? started?.id;
            if (nid) {
              roleWrites[lead.role] = { runId: String(nid), startedAt: new Date().toISOString(), nudges: (rec.nudges ?? 0) + 1, cursor: 0 };
              task.crewRuns![lead.role] = roleWrites[lead.role];
              notes.push(`crew stalled — nudged ${lead.name} (${(rec.nudges ?? 0) + 1}/${MAX_NUDGES})`);
            } else {
              notes.push('crew stalled — nudge failed to start, will retry');
            }
            dirty = true;
          }
        }
      }
      // 4. Dev preview liveness (mechanical signal the app serves).
      if (isDevTeam(task) && token) {
        const res = await fetch(`https://${sb!.endpoint}/dev/?port=5173`, {
          headers: { 'X-aws-proxy-auth': token! },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }).catch(() => null);
        notes.push(res && res.ok ? 'dev preview live on 5173' : 'dev preview not up yet');
      }
      if (dirty) {
        await Promise.all(
          Object.entries(roleWrites).map(([role, run]) => setCrewRun(task.taskId, role, run).catch(() => null)),
        );
      }
    }
    await touchTask(task.taskId, { lastCrewCheck: now }).catch(() => {});
    return notes;
  } catch (e) {
    return notes;
  }
}
