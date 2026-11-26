/** Verify the new image: boot → POST voice turns → GET history → terminate. No keys needed. */
import { CreateMicrovmAuthTokenCommand, GetMicrovmCommand, RunMicrovmCommand, TerminateMicrovmCommand } from '@aws-sdk/client-lambda-microvms';
import { EGRESS_INTERNET, INGRESS_ALL, loadState, mv, waitFor } from './config.js';

async function vmFetch(endpoint: string, token: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://${endpoint}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'X-aws-proxy-auth': token, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function main(): Promise<void> {
  const { imageArn } = loadState();
  if (!imageArn) throw new Error('no imageArn — run 02 first');
  const run = await mv.send(new RunMicrovmCommand({
    imageIdentifier: imageArn,
    runHookPayload: JSON.stringify({ ownerId: 'verify', computerId: `verify-${Date.now().toString(36)}` }),
    ingressNetworkConnectors: [INGRESS_ALL],
    egressNetworkConnectors: [EGRESS_INTERNET],
    idlePolicy: { autoResumeEnabled: false, maxIdleDurationSeconds: 600, suspendedDurationSeconds: 300 },
    maximumDurationInSeconds: 1800,
  }));
  const vmId = run.microvmId!;
  console.log('vm:', vmId);
  try {
    const info: any = await waitFor('RUNNING', async () => {
      const r: any = await mv.send(new GetMicrovmCommand({ microvmIdentifier: vmId }));
      console.log('  state=' + r.state);
      return r.state === 'RUNNING' ? r : null;
    }, { intervalMs: 15000, timeoutMs: 10 * 60_000 });
    const tok: any = await mv.send(new CreateMicrovmAuthTokenCommand({ microvmIdentifier: vmId, allowedPorts: [{ port: 8080 }], expirationInMinutes: 15 }));
    const token = tok?.authToken?.['X-aws-proxy-auth'] ?? '';
    if (!token) throw new Error('no vm token');
    const cid = encodeURIComponent('rent:verify#concierge');
    const post = await vmFetch(info.endpoint, token, `/history/${cid}`, {
      method: 'POST',
      body: JSON.stringify({ turns: [{ vid: 'call1:0', role: 'user', text: 'where is the venue?', at: new Date().toISOString() }, { vid: 'call1:1', role: 'assistant', text: 'Hall 1, Impact.', at: new Date().toISOString() }, { vid: 'call1:0', role: 'user', text: 'DUPLICATE', at: new Date().toISOString() }] }),
    });
    console.log('POST:', post.status, post.text.slice(0, 120));
    const get = await vmFetch(info.endpoint, token, `/history/${cid}`);
    const msgs = JSON.parse(get.text)?.messages ?? [];
    console.log('GET:', get.status, 'lines=' + msgs.length, JSON.stringify(msgs).slice(0, 200));
    const ok = post.status === 200 && msgs.length === 2 && msgs.every((m: any) => m.kind === 'voice');
    console.log(ok ? 'IMAGE ENDPOINT GREEN' : 'IMAGE ENDPOINT FAIL');
    if (!ok) process.exit(1);
  } finally {
    await mv.send(new TerminateMicrovmCommand({ microvmIdentifier: vmId })).catch(() => null);
    console.log('vm terminated');
  }
}
void main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
