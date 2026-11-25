import type { APIGatewayProxyHandler } from 'aws-lambda';
import { handleNonce } from './nonce';
import { handleVerify } from './verify';
import { handleGetProfile, handleRenameProfile } from './profile';

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    // Browser calls (fetch from /app) need this — API Gateway preflight
    // (OPTIONS) exists, but Lambda-integration responses must allow the
    // origin themselves.
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify(body),
});

// Sign-in with wallet: nonce → EIP-191 sign → session JWT. Profiles are
// keyed by wallet address; the JWT (sub = address) gates /profile.
export const handler: APIGatewayProxyHandler = async (event) => {
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

  try {
    if (route === 'POST /auth/nonce') {
      const r = await handleNonce(body);
      return json(r.statusCode, r.body);
    }
    if (route === 'POST /auth/verify') {
      const r = await handleVerify(body);
      return json(r.statusCode, r.body);
    }
    if (route === 'GET /profile') {
      const r = await handleGetProfile(headers);
      return json(r.statusCode, r.body);
    }
    if (route === 'PUT /profile') {
      const r = await handleRenameProfile(headers, body);
      return json(r.statusCode, r.body);
    }
    return json(404, { error: 'unknown auth route' });
  } catch (e) {
    console.error('[auth] handler failed:', e);
    return json(500, { error: 'auth failed' });
  }
};
