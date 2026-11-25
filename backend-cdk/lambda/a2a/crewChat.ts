import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetMicrovmCommand, LambdaMicrovmsClient } from '@aws-sdk/client-lambda-microvms';
import { getTask } from './store';
import { vmToken } from './vm';
import { getSandbox, putSandbox, resolveSandboxVm } from '../sandboxStore';

// Shared member-run core: the REST crew-chat routes (lambda/app/handlers)
// and the crew-thread A2A skill (lambda/a2a/thread) run the same VM logic.
// Gate behavior is identical for humans and buyer agents.

export const lambdaClient = new LambdaClient({});
export const microvmsClient = new LambdaMicrovmsClient({});

const SANDBOX_FN = process.env.SANDBOX_FN ?? '';

export async function invokeSandboxFn(payload: unknown): Promise<void> {
  if (!SANDBOX_FN) throw new Error('server misconfigured: SANDBOX_FN is not set');
  await lambdaClient.send(
    new InvokeCommand({ FunctionName: SANDBOX_FN, InvocationType: 'Event', Payload: JSON.stringify(payload) }),
  );
}

export interface RunResult {
  statusCode: number;
  body: Record<string, any>;
}

/** Start one member run. Async by design — poll pollRunEvents for chunks. */
export async function startMemberRun(
  ownerRaw: string,
  taskId: string,
  roleRaw: string,
  textRaw: string,
  opts?: { attachments?: string[]; provider?: string; model?: string },
): Promise<RunResult> {
  const owner = ownerRaw.toLowerCase();
  const role = roleRaw.toLowerCase();
  const text = textRaw.trim().slice(0, 4000);
  if (!taskId || !role || !text) {
    return { statusCode: 400, body: { error: 'needs { taskId, role, message }' } };
  }
  const task = await getTask(taskId);
  if (!task || !task.buyer || task.buyer.toLowerCase() !== owner) {
    return { statusCode: 404, body: { error: 'unknown thread' } };
  }
  const member = (task.roster ?? []).find((m) => m.role === role);
  if (!member) {
    return { statusCode: 404, body: { error: `no member '${role}' on this rental` } };
  }
  // Optional run extras (chat-only; the A2A thread skill doesn't send these).
  let attachments: string[] | undefined;
  if (opts?.attachments !== undefined) {
    if (!Array.isArray(opts.attachments) || opts.attachments.some((a) => typeof a !== 'string')) {
      return { statusCode: 400, body: { error: 'attachments must be string[]' } };
    }
    attachments = opts.attachments.slice(0, 5);
    for (const a of attachments) {
      if (!a.startsWith('attachments/') || a.includes('..')) {
        return { statusCode: 400, body: { error: `bad attachment path '${a.slice(0, 80)}'` } };
      }
    }
  }
  let provider: string | undefined;
  let model: string | undefined;
  if (opts?.provider !== undefined || opts?.model !== undefined) {
    provider = String(opts.provider ?? '').slice(0, 80) || undefined;
    model = String(opts.model ?? '').slice(0, 120) || undefined;
    if (!provider && !model) {
      return { statusCode: 400, body: { error: 'model override needs a provider and/or model' } };
    }
  }
  const funded = task.quote?.fundedSeconds ?? 0;
  if (task.status !== 'working') {
    return { statusCode: 409, body: { error: `team is ${task.status} — fund the rental first`, expired: true } };
  }
  const start = task.workingSince ? Date.parse(task.workingSince) : NaN;
  const elapsed = Number.isFinite(start) ? Math.max(0, Math.floor((Date.now() - start) / 1000)) : 0;
  if (elapsed >= funded) {
    return { statusCode: 402, body: { error: 'rental window ended — extend to continue the crew', expired: true } };
  }
  // Self-healing: verify the VM is actually RUNNING (records go stale when
  // the platform reaps VMs). Boot a replacement and wait if not.
  let sb = await resolveSandboxVm(owner);
  let alive = false;
  if (sb) {
    try {
      const got: any = await microvmsClient.send(new GetMicrovmCommand({ microvmIdentifier: sb.vmId }));
      alive = !!(got.endpoint && /running/i.test(JSON.stringify(got.state)));
      if (alive && got.endpoint !== sb.endpoint) {
        sb = { vmId: sb.vmId, endpoint: got.endpoint };
        // Persist: endpoints rotate on resume/reboot; the record must track.
        const rec = await getSandbox(owner).catch(() => null);
        if (rec?.vm && rec.vm.vmId === sb.vmId) {
          rec.vm.endpoint = sb.endpoint;
          await putSandbox(rec).catch(() => {});
        }
      }
    } catch {
      alive = false;
    }
  }
  if (!alive || !sb) {
    // Fire-and-forget: the caller clock can't cover a boot. Caller retries
    // this call once the sandbox is live.
    await invokeSandboxFn({ internal: true, action: 'boot-sandbox', wallet: owner }).catch(() => null);
    return { statusCode: 202, body: { accepted: true, state: 'booting', retryable: true } };
  }
  let token: string;
  try {
    token = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const vmRoster = (task.roster ?? []).map((m) => ({ id: m.role, name: m.name, role: m.title }));
  // Model routing: team lead (roster[0], any role name) runs the catalog
  // default (meta/muse-ember-1.0); every other member runs the cheaper spark.
  const leadRole = (task.roster ?? [])[0]?.role;
  const reqBody: any = {
    text,
    botName: member.name,
    roster: vmRoster,
    system: member.brief,
    ownerId: owner,
    conversationId: `rent:${taskId}#${role}`,
    ...(attachments?.length ? { attachments } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  };
  // Default routing (lead = catalog default, others = cheaper spark) applies
  // only when the caller didn't pick a model explicitly.
  if (role !== leadRole && !provider && !model) {
    reqBody.provider = 'meta';
    reqBody.model = 'muse-spark-1.3-contributor';
  }
  const H = { 'X-aws-proxy-auth': token, 'content-type': 'application/json' };
  let startRes: any = null;
  try {
    const r = await fetch(`https://${sb.endpoint}/task`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status !== 202 && r.status !== 200) {
      return { statusCode: 502, body: { error: `sandbox did not start the run (status ${r.status})` } };
    }
    startRes = await r.json();
  } catch (e) {
    return { statusCode: 502, body: { error: `sandbox unreachable: ${e instanceof Error ? e.message : String(e)}` } };
  }
  const runId = startRes?.runId ?? startRes?.run_id ?? startRes?.id;
  if (!runId) return { statusCode: 502, body: { error: 'sandbox returned no run id' } };
  return { statusCode: 202, body: { accepted: true, runId, conversationId: `rent:${taskId}#${role}` } };
}

/** Poll one started run. Read-only — works even after rental expiry. */
export async function pollRunEvents(
  ownerRaw: string,
  taskId: string,
  roleRaw: string,
  runId: string,
  cursorRaw: number | string,
): Promise<RunResult> {
  const owner = ownerRaw.toLowerCase();
  const role = roleRaw.toLowerCase();
  const cursor = Number(cursorRaw ?? 0) || 0;
  if (!taskId || !role || !runId) {
    return { statusCode: 400, body: { error: 'needs taskId, role, runId' } };
  }
  const task = await getTask(taskId);
  if (!task || !task.buyer || task.buyer.toLowerCase() !== owner) {
    return { statusCode: 404, body: { error: 'unknown thread' } };
  }
  const member = (task.roster ?? []).find((m) => m.role === role);
  if (!member) {
    return { statusCode: 404, body: { error: `no member '${role}' on this rental` } };
  }
  const sb = await resolveSandboxVm(owner);
  if (!sb) {
    return { statusCode: 404, body: { error: 'no live sandbox' } };
  }
  let token: string;
  try {
    token = await vmToken(sb.vmId);
  } catch {
    return { statusCode: 502, body: { error: 'sandbox auth failed' } };
  }
  const ev = await fetch(`https://${sb.endpoint}/runs/${encodeURIComponent(runId)}/events?cursor=${cursor}`, {
    headers: { 'X-aws-proxy-auth': token },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!ev || !ev.ok) {
    return { statusCode: 502, body: { error: 'sandbox unreachable' } };
  }
  const evBody = (await ev.json().catch(() => ({}))) as {
    events?: Array<{ type: string; chunk?: string; output?: string; error?: string; agent?: string; toolCalls?: number }>;
    nextCursor?: number;
    done?: boolean;
  };
  let text = '';
  let fallback = '';
  let note: string | undefined;
  let approval: { approvalId: string; permission: string; target: string } | undefined;
  // Tool/agent activity rows for the thread UI (what the crew is doing).
  const activity: string[] = [];
  let toolCalls: number | null = null;
  for (const e of evBody.events ?? []) {
    if (typeof e.chunk === 'string') text += e.chunk;
    // A final `output` echoes the full reply — only use it when no chunks streamed.
    else if (typeof e.output === 'string') fallback = e.output;
    else if (typeof e.agent === 'string' && e.agent) {
      const label = e.agent.slice(0, 160);
      if (activity[activity.length - 1] !== label) activity.push(label);
    } else if (typeof e.toolCalls === 'number') {
      toolCalls = e.toolCalls;
    } else if ((e.type === 'approval' || e.type === 'question') && !evBody.done) {
      note = `${member.name} needs your input before continuing — reply in this thread.`;
      if (e.type === 'approval') {
        // Surface the gate detail (not just the generic note) so callers —
        // human UI or scripted buyers via POST /approvals/:id on the VM —
        // can decide without another round-trip.
        const ae = e as { approvalId?: string; permission?: string; target?: string };
        if (ae.approvalId) {
          approval = {
            approvalId: String(ae.approvalId),
            permission: String(ae.permission ?? ''),
            target: String(ae.target ?? '').slice(0, 500),
          };
          if (!note) note = `${member.name} needs your input before continuing — reply in this thread.`;
        }
      }
    } else if (e.type === 'error') {
      return { statusCode: 502, body: { error: (e.error ?? 'sandbox run failed').slice(0, 300) } };
    }
  }
  return {
    statusCode: 200,
    body: {
      text: text || fallback,
      nextCursor: evBody.nextCursor ?? cursor + (evBody.events ?? []).length,
      done: !!evBody.done,
      note: note ?? null,
      approval: approval ?? null,
      activity,
      toolCalls,
    },
  };
}
