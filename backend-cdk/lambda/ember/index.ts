import type { APIGatewayProxyHandler } from 'aws-lambda';
import { requireAuth } from '../auth/tokens';
import { handleAssign, handleCatalog, handleConnect, handleDeleteHistory, handleDisconnect, handleHistory, handleMemberHistory, handleMessage, handlePending, handleSandboxShutdown, handleSandboxTerminate, handleTeam } from './handlers';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(body),
});

// Ember: assistant catalog + assignment (REST) and streaming chat (WebSocket).
// One Lambda serves both: WebSocket events carry requestContext.routeKey,
// REST events carry httpMethod + resource.
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // ---- WebSocket routes ----
    const routeKey = (event.requestContext as unknown as { routeKey?: string })?.routeKey;
    if (routeKey === '$connect') return handleConnect(event);
    if (routeKey === '$disconnect') return handleDisconnect(event);
    if (routeKey) return handleMessage(event); // custom 'message' route

    // ---- REST routes ----
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: CORS, body: '' };
    }
    if (event.httpMethod === 'GET' && event.resource === '/assistants') {
      const r = await handleCatalog();
      return json(r.statusCode, r.body);
    }

    let body: any = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        return json(400, { error: 'body must be JSON' });
      }
    }
    const headers = event.headers as Record<string, string | undefined>;
    const route = `${event.httpMethod} ${event.resource}`;

    if (route.startsWith('GET /rent/') || route.startsWith('POST /rent/') || route === 'POST /assistants/assign' || route === 'GET /chat/history' || route === 'DELETE /chat/history') {
      let address: string;
      try {
        address = await requireAuth(headers);
      } catch {
        return json(401, { error: 'missing or invalid session token' });
      }
      if (route === 'POST /assistants/assign') {
        const r = await handleAssign(address, body);
        return json(r.statusCode, r.body);
      }
      if (route === 'DELETE /chat/history') {
        const r = await handleDeleteHistory(address, event.queryStringParameters ?? {});
        return json(r.statusCode, r.body);
      }
      if (route === 'GET /rent/pending') {
        const r = await handlePending(address);
        return json(r.statusCode, r.body);
      }
      if (route === 'GET /rent/messages') {
        const r = await handleMemberHistory(address, event.queryStringParameters ?? {});
        return json(r.statusCode, r.body);
      }
      if (route === 'GET /rent/team') {
        const r = await handleTeam(address);
        return json(r.statusCode, r.body);
      }
      if (route === 'POST /rent/sandbox/suspend') {
        const r = await handleSandboxShutdown(address, body);
        return json(r.statusCode, r.body);
      }
      if (route === 'POST /rent/sandbox/terminate') {
        const r = await handleSandboxTerminate(address, body);
        return json(r.statusCode, r.body);
      }
      const r = await handleHistory(address, event.queryStringParameters ?? {});
      return json(r.statusCode, r.body);
    }
    return json(404, { error: 'unknown ember route' });
  } catch (e) {
    console.error('[ember] handler failed:', e);
    return json(500, { error: 'ember failed' });
  }
};
