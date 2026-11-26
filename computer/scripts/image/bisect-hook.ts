/**
 * Bisect the sandbox VM deaths: raw RunMicrovm + backend-identical /hooks/run
 * POST (secrets + workspace sync config), then NOTHING else. If the VM dies,
 * the hook payload/config kills it. If it lives 10+ min, the killer is in
 * perms/smoke/serve/crew — the next bisect step.
 *
 * Run: npx tsx computer/scripts/image/bisect-hook.ts   (repo root)
 * Needs: computer/scripts/image/.env + PROVIDER_API_KEY in shell env.
 */
import {
  CreateMicrovmAuthTokenCommand,
  GetMicrovmCommand,
  RunMicrovmCommand,
} from '@aws-sdk/client-lambda-microvms';
import { EGRESS_INTERNET, INGRESS_ALL, IMAGE_NAME, REGION, mv, waitFor } from './config';

async function vmFetch(endpoint: string, token: string, path: string, init?: RequestInit): Promise<{ status: number; text: string }> {
  const res = await fetch(`https://${endpoint}${path}`, {
    ...init,
    headers: { 'X-aws-proxy-auth': token, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, text: await res.text().catch(() => '') };
}

async function main(): Promise<void> {
  const providerKey = process.env.PROVIDER_API_KEY ?? '';
  if (!providerKey) throw new Error('PROVIDER_API_KEY required in shell env');
  const accountId = process.env.MICROVM_BUILD_ROLE_ARN?.split(':')[4];
  if (!accountId) throw new Error('MICROVM_BUILD_ROLE_ARN required');
  const imageArn = `arn:aws:lambda:${REGION}:${accountId}:microvm-image:${IMAGE_NAME}`;
  const computerId = `sb-bisect-${Date.now().toString(36)}`;

  const run = await mv.send(new RunMicrovmCommand({
    imageIdentifier: imageArn,
    runHookPayload: JSON.stringify({ ownerId: 'wallet-bisect', computerId }),
    ingressNetworkConnectors: [INGRESS_ALL],
    egressNetworkConnectors: [EGRESS_INTERNET],
    idlePolicy: { autoResumeEnabled: true, maxIdleDurationSeconds: 150, suspendedDurationSeconds: 604800 },
    maximumDurationInSeconds: 28800,
  }));
  const vmId = run.microvmId;
  if (!vmId) throw new Error('no microvmId');
  console.log(`VM ${vmId} starting (sandbox-identical boot, then idle watch)...`);
  const info = await waitFor('run to RUNNING', async () => {
    const res = await mv.send(new GetMicrovmCommand({ microvmIdentifier: vmId }));
    console.log(`  ... state=${res.state}`);
    return res.state === 'RUNNING' ? res : null;
  }, { intervalMs: 15_000, timeoutMs: 10 * 60_000 });
  if (!info.endpoint) throw new Error('VM has no endpoint');

  const tok: any = await mv.send(new CreateMicrovmAuthTokenCommand({
    microvmIdentifier: vmId, allowedPorts: [{ port: 8080 }], expirationInMinutes: 60,
  }));
  const token = tok?.authToken?.['X-aws-proxy-auth'] ?? '';
  if (!token) throw new Error('no auth token');

  // Backend-identical /hooks/run (same body shape as sandbox.ts boot flow).
  const hook = await vmFetch(info.endpoint, token, '/hooks/run', {
    method: 'POST',
    body: JSON.stringify({
      ownerId: 'wallet-bisect',
      computerId,
      secrets: { PROVIDER_API_KEY: providerKey },
      usageToken: `crewtopia-${computerId.slice(0, 8)}`,
      apiUrl: 'https://h9907ecjy9.execute-api.ap-southeast-1.amazonaws.com/prod',
      workspace: { bucket: 'wayfind-microvm-artifacts-ap-southeast-1', prefix: 'backups/' },
    }),
  });
  console.log(`hooks/run → ${hook.status} ${hook.text.slice(0, 200)}`);

  // Backend-identical follow-ups: permissions seed, smoke task, serve task.
  // Any of these killing the VM identifies the step — watch after each.
  const perms = await vmFetch(info.endpoint, token, '/permissions', {
    method: 'PUT',
    body: JSON.stringify({ rules: [{ permission: '*', pattern: '*', action: 'allow' }] }),
  });
  console.log(`permissions → ${perms.status}`);
  const smoke = await vmFetch(info.endpoint, token, '/task', {
    method: 'POST',
    body: JSON.stringify({ text: 'Reply with exactly: SANDBOX READY. No tools.', ownerId: 'wallet-bisect' }),
  });
  console.log(`smoke /task → ${smoke.status} ${smoke.text.slice(0, 120)}`);
  const serve = await vmFetch(info.endpoint, token, '/task', {
    method: 'POST',
    body: JSON.stringify({
      text: 'Serve /srv/computer/workspace on port 5173 in the background and keep it running. Verify with curl, then reply SERVING. Use tools, no questions.',
      ownerId: 'wallet-bisect',
    }),
  });
  console.log(`serve /task → ${serve.status} ${serve.text.slice(0, 120)}`);

  // Idle watch: no perms, no smoke, no crew. 12 min.
  // Idle watch: with a 150s idle policy the platform should suspend the VM
  // around [+3m]. If it suspends (and resumes on next traffic) the suspend
  // path works; if it terminates instead, we've reproduced the bug.
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 60_000));
    const s: any = await mv.send(new GetMicrovmCommand({ microvmIdentifier: vmId })).catch(() => null);
    console.log(`[+${i + 1}m] state=${s?.state ?? 'probe-failed'}`);
    if (!s || s.state === 'TERMINATED') break;
  }
  console.log('bisect done (VM left running — terminate manually)');
}

void main();
