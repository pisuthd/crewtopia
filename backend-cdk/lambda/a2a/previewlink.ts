import { randomUUID } from 'node:crypto';
import { getTask } from './store';
import { vmToken } from './vm';
import { previewUrl } from '../previewLink';
import { rentalExpired } from './relay';
import { agentText, rpc, rpcError } from './rpc';

// preview-link: mint a fresh 15-min preview URL for a live rental.
// { task_id, port? } — repeatable, on demand. Probes the dev server first
// so callers never get a link to a dead port.
export async function handlePreviewLink(id: unknown, data: any) {
  const taskId = String(data.task_id ?? '');
  if (!taskId) return rpcError(id, -32602, 'preview-link needs { task_id }');
  try {
    const task = await getTask(taskId);
    if (!task) return rpcError(id, -32602, `no task ${taskId}`);
    if ((task.status !== 'working' && task.status !== 'funding') || rentalExpired(task)) {
      return rpcError(id, -32602, 'no live rental — fund time first');
    }
    if (!task.vm?.vmId || !task.vm?.endpoint || task.vm.terminatedAt || task.vm.suspendedAt) {
      return rpcError(id, -32602, 'sandbox is not running for this task yet');
    }
    const port = Number(data.port ?? 5173) || 5173;
    const token = await vmToken(task.vm.vmId);
    const probe = await fetch(`https://${task.vm.endpoint}/dev/?port=${port}`, {
      headers: { 'X-aws-proxy-auth': token },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!probe || probe.status !== 200) {
      return rpc(
        id,
        agentText(taskId, randomUUID(), 'Sandbox is up but nothing is serving on port 5173 yet — ask the crew to start the dev server, then ask for the link again.', []),
      );
    }
    const url = previewUrl(taskId, port);
    if (!url) return rpcError(id, -32603, 'preview mint misconfigured');
    return rpc(
      id,
      agentText(taskId, randomUUID(), `Preview is live (15-min link): ${url}`, [
        { artifactId: randomUUID(), name: 'preview', parts: [{ kind: 'data', data: { url, port, taskId } }] },
      ]),
    );
  } catch (e) {
    return rpcError(id, -32602, e instanceof Error ? e.message : 'preview failed');
  }
}
