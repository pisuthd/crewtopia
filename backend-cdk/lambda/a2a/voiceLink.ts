import { randomUUID } from 'node:crypto';
import { getTask, touchTask } from './store';
import { verifyBinding } from './accept';
import { agentText, rpc, rpcError } from './rpc';

// crew-voice-link: mint a guest Talk URL for a WORKING rental so the buyer
// agent can hand voice to its own customer (no wallet, no app account).
// Same rules as the REST guest-link route: buyer-owned + working only.
// The link dies with the rental (guest-token requires working status), and
// crew-end revokes it implicitly. Returns linkId + path; `url` is absolute
// only when FRONTEND_URL is configured on the function.
export async function handleVoiceLink(id: unknown, data: any) {
  const taskId = String(data.task_id ?? '');
  if (!taskId) return rpcError(id, -32602, 'crew-voice-link needs a task_id');
  let buyer: string;
  try {
    buyer = (await verifyBinding(data)).toLowerCase();
  } catch (e) {
    return rpcError(id, -32602, e instanceof Error ? e.message : 'binding failed');
  }
  const task: any = await getTask(taskId).catch(() => null);
  if (!task) {
    return rpc(id, agentText('missing', randomUUID(), `No task ${taskId} on this team. Negotiate first.`));
  }
  if (!task.buyer || String(task.buyer).toLowerCase() !== buyer) {
    return rpcError(id, -32602, 'task is not bound to this buyer wallet');
  }
  if (task.status !== 'working') {
    return rpcError(id, -32602, 'voice links mint only while the rental is working — fund it first');
  }
  const linkId = randomUUID();
  await touchTask(taskId, { guestLinkId: linkId });
  const path = `/voice/g/${linkId}`;
  const base = (process.env.FRONTEND_URL ?? '').replace(/\/+$/, '');
  return rpc(id, {
    linkId,
    path,
    url: base ? `${base}${path}` : path,
    team: task.teamId ?? 'dev-crew',
    note: 'Share the URL with your customer — no wallet needed. The link dies when the rental ends.',
  });
}
