import { randomUUID } from 'node:crypto';

/** Public receipt URL for a task (also used as the submit deliverable_url). */
export function receiptUrl(taskId: string): string {
  return `https://h9907ecjy9.execute-api.ap-southeast-1.amazonaws.com/prod/a2a/tasks/${taskId}`;
}

export function agentText(taskId: string, contextId: string, text: string, artifacts: unknown[] = []) {
  return {
    id: taskId,
    contextId,
    status: {
      state: taskId === 'missing' ? 'failed' : 'submitted',
      message: { kind: 'message', role: 'agent', messageId: randomUUID(), parts: [{ kind: 'text', text }] },
    },
    artifacts,
  };
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const rpc = (id: unknown, result: unknown, statusCode = 200) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify({ jsonrpc: '2.0', id, result }),
});

export const rpcError = (id: unknown, code: number, message: string) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }),
});
