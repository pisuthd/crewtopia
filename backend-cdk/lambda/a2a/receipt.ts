import { TABLE } from './clients';
import { getTask } from './store';
import { CORS, receiptUrl } from './rpc';

// Public task receipt (GET /a2a/tasks/{id}): the resolvable deliverable —
// buyers, judges, and the escrow submit all point here.
export async function handleReceipt(taskId: string) {
  if (!TABLE || !taskId) {
    return { statusCode: 404, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify({ error: 'unknown task' }) };
  }
  const task = await getTask(taskId);
  if (!task) {
    return { statusCode: 404, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify({ error: 'unknown task' }) };
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
    body: JSON.stringify({
      ...task,
      team: 'wayfind-dev-team',
      network: 'bsc-testnet',
      receiptUrl: receiptUrl(task.taskId),
    }),
  };
}
