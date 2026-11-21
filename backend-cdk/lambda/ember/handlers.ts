import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { verifySession } from '../auth/tokens';
import { ASSISTANTS, isAssistantId } from './catalog';
import { contextFor } from './context';
import { streamReply } from './llm';
import {
  appendMemberMessages,
  appendMessages,
  assignAssistant,
  deleteConnection,
  deleteConversation,
  getConnection,
  getConversation,
  getMemberConversation,
  putConnection,
  unassignAssistant,
} from './store';
import { findCrewsByBuyer, findPendingByBuyer, putTask as putA2aTask } from '../a2a/store';
import { findWorkingByBuyer, getTask } from '../a2a/store';
import { relayToMember, suspendVm } from '../a2a/relay';
import { terminateVm } from '../a2a/vm';
import { getMember } from './teams';

// ---------- REST ----------

export async function handleCatalog() {
  return { statusCode: 200, body: { assistants: ASSISTANTS } };
}

export async function handleAssign(address: string, body: any) {
  const raw = body?.assistantId ?? null;
  if (raw === null) {
    await unassignAssistant(address);
    return { statusCode: 200, body: { ok: true, assistantId: null } };
  }
  const assistantId = String(raw);
  if (!isAssistantId(assistantId)) {
    return { statusCode: 400, body: { error: 'unknown assistant' } };
  }
  await assignAssistant(address, assistantId);
  return { statusCode: 200, body: { ok: true, assistantId } };
}

export async function handleDeleteHistory(address: string, params: Record<string, string | undefined>) {
  const assistantId = String(params.assistantId ?? 'ember');
  if (!isAssistantId(assistantId)) {
    return { statusCode: 400, body: { error: 'unknown assistant' } };
  }
  await deleteConversation(address, assistantId);
  return { statusCode: 200, body: { ok: true } };
}

export async function handlePending(address: string) {
  const task = await findPendingByBuyer(address);
  if (!task?.quote) return { statusCode: 200, body: { task: null } };
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
      },
    },
  };
}

export async function handleHistory(address: string, params: Record<string, string | undefined>) {
  const assistantId = String(params.assistantId ?? 'ember');
  if (!isAssistantId(assistantId)) {
    return { statusCode: 400, body: { error: 'unknown assistant' } };
  }
  const convo = await getConversation(address, assistantId);
  return { statusCode: 200, body: { conversationId: convo.conversationId, messages: convo.messages, context: contextFor(convo.messages) } };
}

export async function handleMemberHistory(address: string, params: Record<string, string | undefined>) {
  const taskId = String(params.taskId ?? '');
  const role = String(params.role ?? '');
  const task = await getTask(taskId);
  if (!task || !task.buyer || task.buyer.toLowerCase() !== address.toLowerCase()) {
    return { statusCode: 404, body: { error: 'unknown thread' } };
  }
  const convo = await getMemberConversation(address, taskId, role);
  return { statusCode: 200, body: { conversationId: convo.conversationId, messages: convo.messages, context: contextFor(convo.messages) } };
}

export async function handleTeam(address: string) {
  const tasks = await findCrewsByBuyer(address);
  return {
    statusCode: 200,
    body: {
      crews: tasks.map((task) => {
        const elapsedS = task.workingSince
          ? Math.max(0, Math.floor((Date.now() - new Date(task.workingSince).getTime()) / 1000))
          : 0;
        return {
          taskId: task.taskId,
          team: task.quote?.displayName ?? 'Dev Crew',
          status: task.status,
          jobId: task.jobId,
          fundedSeconds: task.quote?.fundedSeconds ?? 0,
          elapsedSeconds: elapsedS,
          minutesLeft: Math.max(0, Math.round(((task.quote?.fundedSeconds ?? 0) - elapsedS) / 60)),
          vmLive: !!task.vm?.vmId && !!task.vm?.endpoint && !task.vm?.terminatedAt && !task.vm?.suspendedAt,
          vmSuspended: !!task.vm?.suspendedAt && !task.vm?.terminatedAt,
          brief: task.brief,
        };
      }),
    },
  };
}

export async function handleSandboxShutdown(address: string, body: any) {
  const taskId = String(body?.taskId ?? '');
  if (!taskId) return { statusCode: 400, body: { error: 'needs { taskId }' } };
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
  const taskId = String(body?.taskId ?? '');
  if (!taskId) return { statusCode: 400, body: { error: 'needs { taskId }' } };
  const task = await getTask(taskId);
  if (!task || !task.buyer || task.buyer.toLowerCase() !== address.toLowerCase()) {
    return { statusCode: 404, body: { error: 'unknown sandbox' } };
  }
  if (!task.vm?.vmId || task.vm.terminatedAt) {
    return { statusCode: 409, body: { error: 'sandbox is already gone' } };
  }
  const note = await terminateVm(task);
  // Ending the rental: drop it from the live roster/member chat and free the
  // one-team slot so the buyer can hire anew. Escrow stays locked on-chain
  // until expiry (claimRefund path unchanged).
  task.status = 'ended';
  task.endedAt = new Date().toISOString();
  await putA2aTask(task);
  return { statusCode: 200, body: { ok: true, state: 'terminated', note } };
}

// ---------- WebSocket ----------

function mgmtClient(domain: string, stage: string): ApiGatewayManagementApiClient {
  return new ApiGatewayManagementApiClient({ endpoint: `https://${domain}/${stage}` });
}

async function post(domain: string, stage: string, connectionId: string, data: unknown): Promise<void> {
  await mgmtClient(domain, stage).send(
    new PostToConnectionCommand({ ConnectionId: connectionId, Data: Buffer.from(JSON.stringify(data)) }),
  );
}

export async function handleConnect(event: any): Promise<{ statusCode: number; body: string }> {
  const token = event.queryStringParameters?.token ?? '';
  const connectionId = event.requestContext.connectionId;
  try {
    const address = await verifySession(token);
    await putConnection(connectionId, address);
    return { statusCode: 200, body: 'connected' };
  } catch {
    return { statusCode: 401, body: 'unauthorized' };
  }
}

export async function handleDisconnect(event: any): Promise<{ statusCode: number; body: string }> {
  await deleteConnection(event.requestContext.connectionId).catch(() => {});
  return { statusCode: 200, body: 'disconnected' };
}

type ChatAction = { action: 'chat'; assistantId?: string; message?: string; hello?: boolean };
type MemberChatAction = {
  action: 'member-chat';
  taskId?: string;
  role?: string;
  message?: string;
};

// Ember-initiated greeting for empty threads (mirrors the reference hello
// run): no user bubble, failures stay silent, exactly-once via the history
// check below — the intro instruction is never persisted as a user message.
const HELLO_INSTRUCTION =
  'Introduce yourself briefly as Ember, the Crewtopia hiring assistant. ' +
  'Mention you rent out the Dev Crew by the hour and ask what they want to build and how long to rent it for. ' +
  'Keep it under 80 words.';

export async function handleMessage(event: any): Promise<{ statusCode: number; body: string }> {
  const rc = event.requestContext;
  const connectionId = rc.connectionId as string;
  const domain = rc.domainName as string;
  const stage = rc.stage as string;

  const owner = await getConnection(connectionId);
  if (!owner) {
    await post(domain, stage, connectionId, { type: 'error', error: 'not connected — reconnect with a session token' }).catch(() => {});
    return { statusCode: 200, body: 'stale connection' };
  }

  let action: ChatAction | MemberChatAction;
  try {
    action = JSON.parse(event.body ?? '{}');
  } catch {
    await post(domain, stage, connectionId, { type: 'error', error: 'body must be JSON' }).catch(() => {});
    return { statusCode: 200, body: 'bad json' };
  }
  if (action.action === 'member-chat') {
    return handleMemberChat(domain, stage, connectionId, owner, action);
  }
  const isHello = action.hello === true;
  if (action.action !== 'chat' || (!isHello && (typeof action.message !== 'string' || !action.message.trim()))) {
    await post(domain, stage, connectionId, { type: 'error', error: "send { action: 'chat', assistantId, message }" }).catch(() => {});
    return { statusCode: 200, body: 'bad action' };
  }
  const assistantId = action.assistantId ?? 'ember';
  if (!isAssistantId(assistantId)) {
    await post(domain, stage, connectionId, { type: 'error', error: 'unknown assistant' }).catch(() => {});
    return { statusCode: 200, body: 'bad assistant' };
  }
  const userText = isHello ? '' : (action.message ?? '').trim().slice(0, 4000);

  try {
    const convo = await getConversation(owner, assistantId);
    // Hello runs only fire on empty threads — a non-empty history means a
    // greeting already exists (or the user spoke first); stay silent.
    if (isHello && convo.messages.length > 0) {
      return { statusCode: 200, body: 'hello skipped' };
    }
    await post(domain, stage, connectionId, { type: 'start' }).catch(() => {});
    let full = '';
    for await (const delta of streamReply(convo.messages, isHello ? HELLO_INSTRUCTION : userText, async (text) => {
      await post(domain, stage, connectionId, { type: 'status', text }).catch(() => {});
    }, owner)) {
      full += delta;
      await post(domain, stage, connectionId, { type: 'token', text: delta }).catch(() => {});
    }
    const at = new Date().toISOString();
    // Hello persists the assistant reply only — the intro instruction must
    // never appear as a user message in history.
    const updated = isHello
      ? await appendMessages(owner, assistantId, [{ role: 'assistant', text: full, at }])
      : await appendMessages(owner, assistantId, [
          { role: 'user', text: userText, at },
          { role: 'assistant', text: full, at: new Date().toISOString() },
        ]);
    await post(domain, stage, connectionId, { type: 'done', context: contextFor(updated.messages) }).catch(() => {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await post(domain, stage, connectionId, { type: 'error', error: msg.slice(0, 300) }).catch(() => {});
  }
  return { statusCode: 200, body: 'ok' };
}

/** Direct member thread over the WS (streams VM chunks as token frames). */
export async function handleMemberChat(
  domain: string,
  stage: string,
  connectionId: string,
  owner: string,
  action: MemberChatAction,
): Promise<{ statusCode: number; body: string }> {
  const role = String(action.role ?? '');
  const text = (action.message ?? '').trim().slice(0, 4000);
  if (!getMember(role) || !text) {
    await post(domain, stage, connectionId, { type: 'error', error: "send { action: 'member-chat', taskId, role, message }" }).catch(() => {});
    return { statusCode: 200, body: 'bad member action' };
  }
  let taskId = String(action.taskId ?? '');
  if (!taskId) {
    const live = await findWorkingByBuyer(owner);
    if (!live) {
      await post(domain, stage, connectionId, { type: 'error', error: 'no live crew — fund a rental first' }).catch(() => {});
      return { statusCode: 200, body: 'no live crew' };
    }
    taskId = live.taskId;
  }
  try {
    await post(domain, stage, connectionId, { type: 'start' }).catch(() => {});
    let full = '';
    const r = await relayToMember({
      taskId,
      role,
      text,
      owner,
      requireBuyer: true,
      budgetMs: 100_000,
      onChunk: async (chunk) => {
        full += chunk;
        await post(domain, stage, connectionId, { type: 'token', text: chunk }).catch(() => {});
      },
      onStatus: async (s) => {
        await post(domain, stage, connectionId, { type: 'status', text: s }).catch(() => {});
      },
    });
    if (r.note && !r.reply) full = r.note;
    else if (r.note) full += `\n\n_${r.note}_`;
    const at = new Date().toISOString();
    const updated = await appendMemberMessages(owner, taskId, role, [
      { role: 'user', text, at },
      { role: 'assistant', text: full, at: new Date().toISOString() },
    ]);
    await post(domain, stage, connectionId, { type: 'done', context: contextFor(updated.messages) }).catch(() => {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await post(domain, stage, connectionId, { type: 'error', error: msg.slice(0, 300) }).catch(() => {});
  }
  return { statusCode: 200, body: 'ok' };
}
