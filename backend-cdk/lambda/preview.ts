import type { APIGatewayProxyHandler } from 'aws-lambda';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  CreateMicrovmAuthTokenCommand,
  LambdaMicrovmsClient,
} from '@aws-sdk/client-lambda-microvms';
import { recoverMessageAddress } from 'viem';

// Phase 4: preview relay. The VM token is minted per request and never
// leaves the server. Two endpoints (same lambda, path-routed):
//   POST /a2a/sandbox/preview/link { task_id, port, buyerAddress, nonce, buyerSig }
//     → buyer-signed mint (sig over `Crewtopia preview <taskId>`), returns a
//       15-min HMAC URL.
//   GET /a2a/sandbox/preview/view/{taskId}/{port}/{path*}?sig=&exp=
//     → verifies HMAC + expiry, mints a VM token, reverse-proxies.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TASKS_TABLE ?? '';
const SECRET = process.env.PREVIEW_SECRET ?? '';
const REGION = process.env.AWS_REGION ?? 'ap-southeast-1';
const vm = new LambdaMicrovmsClient({ region: REGION });
const TTL_S = 900;

function sign(taskId: string, port: string, exp: string): string {
  return createHmac('sha256', SECRET).update(`${taskId}.${port}.${exp}`).digest('hex');
}

const TEXT = /^(text\/|application\/(json|javascript|x-www-form-urlencoded)|image\/svg)/;

export const handler: APIGatewayProxyHandler = async (event) => {
  const json = (code: number, result: unknown) => ({
    statusCode: code,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  });

  if (!TABLE || !SECRET) return json(500, { error: 'server misconfigured' });
  const path: string = (event as any).path ?? event.path ?? '';

  // --- mint a signed preview URL (buyer proves ownership) ---
  if (event.httpMethod === 'POST') {
    let body: any = {};
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return json(400, { error: 'body must be JSON' });
    }
    const { task_id: taskId, port = 5173, buyerAddress, nonce, buyerSig } = body;
    if (!taskId || !buyerAddress || !nonce || !buyerSig) {
      return json(400, { error: 'needs { task_id, port, buyerAddress, nonce, buyerSig }' });
    }
    const out = await ddb.send(new GetCommand({ TableName: TABLE, Key: { taskId } }));
    const task = out.Item as any;
    if (!task?.vm?.vmId) return json(409, { error: `task ${taskId} has no live sandbox — boot one first` });
    let signer: string;
    try {
      signer = await recoverMessageAddress({
        message: `Crewtopia preview v1\ntask: ${taskId}`,
        signature: buyerSig as `0x${string}`,
      });
    } catch {
      return json(403, { error: 'buyerSig invalid' });
    }
    const bound = (task.buyer ?? '').toLowerCase();
    if (!bound || (signer.toLowerCase() !== bound && signer.toLowerCase() !== String(buyerAddress).toLowerCase())) {
      return json(403, { error: 'buyerSig must be the bound buyer (or declared owner of an unbound task)' });
    }
    const exp = String(Math.floor(Date.now() / 1000) + TTL_S);
    const portStr = String(port);
    const sig = sign(taskId, portStr, exp);
    const base =
      `https://8lgt6x9mn8.execute-api.ap-southeast-1.amazonaws.com/prod/a2a/sandbox/preview/view/` +
      `${taskId}/${portStr}/`;
    const url = `${base}?sig=${sig}&exp=${exp}`;
    return json(200, { url, base, sig, exp });
  }

  // --- serve through the relay ---
  const m = /\/preview\/view\/([^/]+)\/([^/]+)\/?(.*)$/.exec(path);
  if (!m) return json(404, { error: 'unknown preview path' });
  const [, taskId, portStr, rest] = m;
  const qs = event.queryStringParameters ?? {};
  const exp = Number(qs.exp ?? 0);
  if (!qs.sig || !exp || Date.now() / 1000 > exp) {
    return json(403, { error: 'preview link expired or missing sig — mint a fresh one' });
  }
  const want = sign(taskId, portStr, String(exp));
  const a = Buffer.from(qs.sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return json(403, { error: 'bad preview sig' });
  }
  const out = await ddb.send(new GetCommand({ TableName: TABLE, Key: { taskId } }));
  const task = out.Item as any;
  if (!task?.vm?.vmId || !task?.vm?.endpoint) return json(410, { error: 'sandbox gone — boot again' });

  // Token is always for the computer server (8080); dev ports are reached
  // through its /dev reverse-proxy, never directly.
  const tok: any = await vm.send(
    new CreateMicrovmAuthTokenCommand({
      microvmIdentifier: task.vm.vmId,
      allowedPorts: [{ port: 8080 }],
      expirationInMinutes: 15,
    }),
  );
  const token = tok?.authToken?.['X-aws-proxy-auth'] ?? '';
  if (!token) return json(502, { error: 'token mint failed' });

  // The relay always enters through the computer server (port 8080): direct
  // path for 8080 itself, /dev/* reverse-proxy for live dev ports. Our
  // sig/exp query is verified here and never forwarded upstream.
  const upstreamPath =
    portStr === '8080' ? `/${rest}` : `/dev/${rest}?port=${encodeURIComponent(portStr)}`;
  const upstream = await fetch(`https://${task.vm.endpoint}${upstreamPath}`, {
    headers: { 'X-aws-proxy-auth': token },
  }).catch(() => null);
  if (!upstream) return json(502, { error: 'sandbox unreachable (suspended or terminated?)' });
  const ct = upstream.headers.get('content-type') ?? 'application/octet-stream';
  const buf = Buffer.from(await upstream.arrayBuffer());
  const headers: Record<string, string> = { 'Content-Type': ct };
  if (TEXT.test(ct)) {
    return { statusCode: upstream.status, headers, body: buf.toString('utf8') };
  }
  return { statusCode: upstream.status, headers, body: buf.toString('base64'), isBase64Encoded: true };
};
