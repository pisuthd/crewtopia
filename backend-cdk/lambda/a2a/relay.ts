import { randomUUID } from 'node:crypto';
import { GetMicrovmCommand, ResumeMicrovmCommand, SuspendMicrovmCommand } from '@aws-sdk/client-lambda-microvms';
import { getTask, putTask } from './store';
import { vmClient } from './clients';
import { vmToken } from './vm';
import { ROSTER, ROLE_BRIEFS, getMember, type MemberRole } from '../ember/teams';
import type { StoredTask } from './types';

export interface RelayOpts {
  taskId: string;
  role: string;
  text: string;
  owner: string;
  /** App path verifies the session buyer owns the task; A2A skill path skips it. */
  requireBuyer?: boolean;
  /** Max time to wait for the VM run (ms). */
  budgetMs?: number;
  onChunk?: (text: string) => Promise<void>;
  onStatus?: (text: string) => Promise<void>;
}

export interface RelayResult {
  reply: string;
  runId: string;
  done: boolean;
  note?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function vmFetch(task: StoredTask, path: string, init?: RequestInit) {
  const token = await vmToken(task.vm!.vmId);
  const res = await fetch(`https://${task.vm!.endpoint}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'X-aws-proxy-auth': token, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch { /* plain text */ }
  return { status: res.status, text, json };
}

/** Rental clock check: workingSince + fundedSeconds. */
export function rentalExpired(task: StoredTask, now = Date.now()): boolean {
  const start = new Date(task.workingSince ?? task.createdAt).getTime();
  const budget = (task.quote?.fundedSeconds ?? 0) * 1000;
  return Number.isFinite(start) && now - start >= budget;
}

/** Suspend a task VM (files survive suspend; resume restores them). */
export async function suspendVm(task: StoredTask): Promise<string> {
  if (!task.vm?.vmId || task.vm.terminatedAt || task.vm.suspendedAt) return 'already suspended or gone';
  try {
    await vmFetch(task, '/hooks/suspend', { method: 'POST', body: '{}' }).catch(() => null);
    await vmClient.send(new SuspendMicrovmCommand({ microvmIdentifier: task.vm.vmId }));
    task.vm.suspendedAt = new Date().toISOString();
    await putTask(task);
    return 'suspended';
  } catch (e) {
    return `suspend failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Resume a suspended task VM and wait for RUNNING. */
export async function resumeVm(task: StoredTask): Promise<void> {
  if (!task.vm?.vmId || task.vm.terminatedAt || !task.vm.suspendedAt) return;
  await vmClient.send(new ResumeMicrovmCommand({ microvmIdentifier: task.vm.vmId }));
  for (let i = 0; i < 24; i++) {
    await sleep(10000);
    const got: any = await vmClient.send(new GetMicrovmCommand({ microvmIdentifier: task.vm!.vmId }));
    if (got.endpoint && /running/i.test(JSON.stringify(got.state))) {
      task.vm.endpoint = got.endpoint;
      delete task.vm.suspendedAt;
      await putTask(task);
      return;
    }
  }
  throw new Error('VM did not resume in time');
}

/**
 * Shared member-chat relay: posts into the task VM's computer as a named
 * crew member and waits for the reply. Used by the A2A team-message skill,
 * Ember's message_member tool, and the app's member threads.
 */
export async function relayToMember(opts: RelayOpts): Promise<RelayResult> {
  const member = getMember(opts.role);
  if (!member) throw new Error(`unknown role '${opts.role}' — pick pm, ux, frontend, or backend`);
  const task = await getTask(opts.taskId);
  if (!task) throw new Error(`no task ${opts.taskId}`);
  if (opts.requireBuyer && (!task.buyer || task.buyer.toLowerCase() !== opts.owner.toLowerCase())) {
    throw new Error('task belongs to a different wallet');
  }
  if (task.status === 'ended') {
    throw new Error('this rental was ended (sandbox shut down) — fund a new rental to hire the crew again');
  }
  if (task.status !== 'working' && task.status !== 'funding') {
    throw new Error(`team is ${task.status} — fund the rental first`);
  }
  // Lazy expiry: the rental clock runs out → park the VM, refuse new turns.
  if (rentalExpired(task)) {
    await suspendVm(task).catch(() => {});
    throw new Error('rental window ended — fund more time to resume the crew (files are kept)');
  }
  if (!task.vm?.vmId || !task.vm?.endpoint || task.vm.terminatedAt || task.vm.suspendedAt) {
    throw new Error('sandbox is not running for this task yet');
  }
  const token = await vmToken(task.vm.vmId);
  const H = { 'X-aws-proxy-auth': token, 'content-type': 'application/json' };
  const roster = ROSTER.map((m) => ({ id: m.role, name: m.name, role: m.title }));

  await opts.onStatus?.(`Asking ${member.name}…`);
  const start = await fetch(`https://${task.vm.endpoint}/task`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      text: opts.text.slice(0, 4000),
      botName: member.name,
      roster,
      system: ROLE_BRIEFS[member.role as MemberRole],
      ownerId: opts.owner.toLowerCase(),
      conversationId: `${opts.taskId}#${member.role}`,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (start.status !== 202) throw new Error(`sandbox did not start the run (status ${start.status})`);
  const { runId } = (await start.json()) as { runId?: string };
  if (!runId) throw new Error('sandbox returned no run id');

  const budgetMs = opts.budgetMs ?? 100_000;
  const deadline = Date.now() + budgetMs;
  let cursor = 0;
  let reply = '';
  let note: string | undefined;
  for (;;) {
    if (Date.now() > deadline) break;
    await sleep(3000);
    const ev = await fetch(`https://${task.vm.endpoint}/runs/${runId}/events?cursor=${cursor}`, {
      headers: H,
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!ev || !ev.ok) continue;
    const body = (await ev.json()) as {
      events?: Array<{ type: string; chunk?: string; output?: string; error?: string }>;
      nextCursor?: number;
      done?: boolean;
    };
    for (const e of body.events ?? []) {
      if (e.type === 'chunk' && e.chunk) {
        reply += e.chunk;
        await opts.onChunk?.(e.chunk);
      } else if ((e.type === 'approval' || e.type === 'question') && !note) {
        note = `${member.name} needs your input before continuing — reply in this thread.`;
      } else if (e.type === 'error') {
        throw new Error(e.error?.slice(0, 300) ?? 'sandbox run failed');
      }
    }
    cursor = body.nextCursor ?? cursor + (body.events ?? []).length;
    if (body.done) return { reply, runId, done: true, note };
  }
  return { reply, runId, done: false, note: note ?? `${member.name} is still working — ask again for the latest.` };
}
