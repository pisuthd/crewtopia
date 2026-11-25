import { getTask } from './store';
import { verifyBinding } from './accept';
import { agentText, rpc, rpcError } from './rpc';
import { pollRunEvents, startMemberRun } from './crewChat';
import { randomUUID } from 'node:crypto';

// crew-thread: buyer agents chat with the hired crew the same way the app
// does — one thread, addressed at the lead by default, @mention / role to
// reach a specific member. DELTAS ONLY: each call returns this turn's
// replies plus a cursor, never the transcript. The agent keeps its own
// context; turns burn rented minutes exactly like human chat.
const WAIT_BUDGET_MS = 20_000;
const POLL_GAP_MS = 2_000;

function rosterLine(task: any): string {
  return (task.roster ?? []).map((m: any) => `${m.name} (role ${m.role})`).join(', ');
}

export async function handleThread(id: unknown, data: any) {
  const taskId = String(data.task_id ?? '');
  if (!taskId) return rpcError(id, -32602, "crew-thread needs a task_id");
  let buyer: string;
  try {
    buyer = (await verifyBinding(data)).toLowerCase();
  } catch (e) {
    return rpcError(id, -32602, e instanceof Error ? e.message : 'binding failed');
  }
  const task = await getTask(taskId);
  if (!task) {
    return rpc(id, agentText('missing', randomUUID(), `No task ${taskId} on this team. Negotiate first.`));
  }
  if (!task.buyer || task.buyer.toLowerCase() !== buyer) {
    return rpcError(id, -32602, 'task is not bound to this buyer wallet');
  }
  // Resolve who this turn is addressed to. Default = lead (roster[0]);
  // roles and @Names both work. Unknown → roster hint, no guessing.
  const roster = task.roster ?? [];
  const leadRole = roster[0]?.role;
  if (!leadRole) return rpcError(id, -32602, 'team has no roster yet');
  const rawTo = String(data.to ?? 'lead').trim();
  let toRole: string;
  if (!rawTo || /^lead$/i.test(rawTo)) {
    toRole = leadRole;
  } else {
    const needle = rawTo.replace(/^@/, '').toLowerCase();
    const hit = roster.find(
      (m: any) => String(m.role).toLowerCase() === needle || String(m.name).toLowerCase() === needle,
    );
    if (!hit) {
      return rpcError(id, -32602, `unknown member '${rawTo}'. Roster: ${rosterLine(task)}`);
    }
    toRole = hit.role;
  }
  const member = roster.find((m: any) => m.role === toRole);

  const text = String(data.text ?? '').trim();
  let runId = String(data.runId ?? '');
  let cursor = Number(data.cursor ?? 0) || 0;
  if (text) {
    const started = await startMemberRun(buyer, taskId, toRole, text);
    const sb = started.body as any;
    if (started.statusCode === 202 && sb?.runId) {
      runId = sb.runId;
      cursor = 0;
    } else {
      // Gate outcomes pass through unchanged: booting/retryable, expired,
      // unfunded, unknown thread. Same semantics as the REST chat route.
      return rpc(id, { accepted: false, ...(sb ?? {}) });
    }
  }
  if (!runId) {
    return rpcError(id, -32602, 'crew-thread needs text (to start a turn) or runId + cursor (to continue one)');
  }
  // Server-side wait: gather this turn's deltas until done or budget out.
  // Unfinished turns return done:false — re-call with runId + cursor.
  const deadline = Date.now() + WAIT_BUDGET_MS;
  let turnText = '';
  let note: string | null = null;
  let done = false;
  for (;;) {
    const p = await pollRunEvents(buyer, taskId, toRole, runId, cursor);
    if (p.statusCode !== 200) {
      return rpc(id, { accepted: false, runId, cursor, ...((p.body as object) ?? {}) });
    }
    const b = p.body as any;
    if (typeof b.text === 'string' && b.text) turnText += b.text;
    cursor = typeof b.nextCursor === 'number' ? b.nextCursor : cursor;
    if (b.note) note = b.note;
    done = !!b.done;
    if (done) break;
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, POLL_GAP_MS));
  }
  return rpc(id, {
    runId,
    replies: [{ role: toRole, name: member?.name ?? toRole, text: turnText }],
    cursor,
    done,
    needs_input: !done && note !== null,
    note,
  });
}
