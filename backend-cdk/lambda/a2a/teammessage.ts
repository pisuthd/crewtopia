import { randomUUID } from 'node:crypto';
import { relayToMember } from './relay';
import { agentText, rpc, rpcError } from './rpc';

// team-message: talk to one named crew member inside a live rental.
// { task_id, role: pm|ux|frontend|backend, message }
export async function handleTeamMessage(id: unknown, data: any) {
  const taskId = String(data.task_id ?? '');
  const role = String(data.role ?? '');
  const message = String(data.message ?? '');
  if (!taskId || !role || !message) {
    return rpcError(id, -32602, 'team-message needs { task_id, role, message }');
  }
  try {
    // A2A is request/response behind a 29s gateway — short budget; the reply
    // carries the run state so callers can poll team-status or ask again.
    const r = await relayToMember({ taskId, role, text: message, owner: '', budgetMs: 25_000 });
    const text = r.reply
      ? `${r.reply}${r.note ? `\n\n_${r.note}_` : ''}`
      : (r.note ?? 'The member is working — ask again for the latest.');
    return rpc(id, agentText(taskId, randomUUID(), text, []));
  } catch (e) {
    return rpcError(id, -32602, e instanceof Error ? e.message : 'team message failed');
  }
}
