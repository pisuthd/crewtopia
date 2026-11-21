import type { APIGatewayProxyHandler } from 'aws-lambda';
import { TABLE } from './clients';
import { rpcError } from './rpc';
import { handleReceipt } from './receipt';
import { handleNegotiate } from './negotiate';
import { handleAccept, handleAcceptFinish } from './accept';
import { handleStatus } from './status';
import { handleDeliver } from './deliver';
import { handleTeamMessage } from './teammessage';
import { handlePreviewLink } from './previewlink';

// Phase 3: escrow handshake. negotiate → quote; accept → server (provider)
// creates the ERC-8183 job (create/register/setBudget); buyer funds on-chain;
// status lazily verifies FUNDED and flips the task to WORKING. Submit/settle
// (team-side delivery) land here next — approval-gated.

export const handler: APIGatewayProxyHandler = async (event) => {
  // Internal async work (IAM-gated Invoke): accept-finish runs the escrow
  // chain calls without the 29s gateway clock. No HTTP shape at all.
  const raw = event as any;
  if (!raw.httpMethod && raw.internal === true && typeof raw.task_id === 'string') {
    const r = await handleAcceptFinish(raw.task_id);
    return { statusCode: 200, body: JSON.stringify(r) };
  }
  if (event.httpMethod === 'GET') {
    return handleReceipt(event.pathParameters?.taskId ?? '');
  }

  let body: any = {};
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return rpcError(null, -32700, 'Parse error: body must be JSON');
  }

  const { jsonrpc, id = null, method, params } = body;
  if (jsonrpc !== '2.0' || method !== 'message/send') {
    return rpcError(id, -32601, 'Only message/send is accepted');
  }

  const message = params?.message ?? {};
  const data = (message.parts ?? []).find(
    (p: any) => p?.kind === 'data' && typeof p?.data === 'object' && p?.data !== null,
  )?.data;
  if (!data || typeof data.skill !== 'string') {
    return rpcError(id, -32602, "message must carry a data part with a 'skill' field");
  }

  if (!TABLE) return rpcError(id, -32603, 'Server misconfigured: TASKS_TABLE is not set');

  if (data.skill === 'negotiate-web3-task') return handleNegotiate(id, message, data);
  if (data.skill === 'accept-web3-quote') return handleAccept(id, data);
  if (data.skill === 'web3-task-status') return handleStatus(id, data);
  if (data.skill === 'web3-deliver') return handleDeliver(id, data);
  if (data.skill === 'team-message') return handleTeamMessage(id, data);
  if (data.skill === 'preview-link') return handlePreviewLink(id, data);

  return rpcError(id, -32602, `Unknown skill: ${JSON.stringify(data.skill)}`);
};
