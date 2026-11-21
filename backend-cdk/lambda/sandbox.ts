import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  CreateMicrovmAuthTokenCommand,
  GetMicrovmCommand,
  LambdaMicrovmsClient,
  RunMicrovmCommand,
  TerminateMicrovmCommand,
} from '@aws-sdk/client-lambda-microvms';
import { recoverMessageAddress } from 'viem';
import { findLiveVmForBuyer, findSuspendedVmForBuyer } from './a2a/store';
import { resumeVm } from './a2a/relay';
import { appendMessages } from './ember/store';

// Phase 4: provision-on-demand. Team-operator-signed POST boots a disposable
// microVM for a funded (WORKING) task: run → wait → token → /hooks/run with
// the dev inference keys → smoke /task → store vmId on the task. Preview
// relay (live dev port) lands next; real builds land after.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TASKS_TABLE ?? '';
const IMAGE = process.env.COMPUTER_IMAGE_ARN ?? '';
const REGION = process.env.AWS_REGION ?? 'ap-southeast-1';
const vm = new LambdaMicrovmsClient({ region: REGION });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CONN = (name: string) => `arn:aws:lambda:${REGION}:aws:network-connector:aws-network-connector:${name}`;

function deliverMessage(taskId: string, action: string, nonce: string): string {
  return `Crewtopia deliver v1\ntask: ${taskId}\naction: ${action}\nnonce: ${nonce}`;
}

async function vmFetch(endpoint: string, token: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://${endpoint}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'X-aws-proxy-auth': token, 'content-type': 'application/json' },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch { /* plain text */ }
  return { status: res.status, text, json };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const bad = (code: number, message: string) => ({
    statusCode: code,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  });
  const ok = (result: unknown) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  });

  // Direct Lambda Invoke (auto-boot) passes the payload without API Gateway wrapping.
  let body: any = (event as any).task_id && !(event as any).httpMethod ? (event as any) : {};
  if (!body.task_id) {
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return bad(400, 'body must be JSON');
    }
  }
  const { task_id: taskId, providerAddress, nonce, providerSig, internal } = body;
  // Internal auto-boot (IAM-gated Invoke from the a2a function) skips the
  // provider signature — the HTTPS path below still requires it.
  const internalCall = internal === true && !(event as any).httpMethod;
  if (!taskId || (!internalCall && (!providerAddress || !nonce || !providerSig))) {
    return bad(400, 'needs { task_id, providerAddress, nonce, providerSig } over deliver/boot message');
  }
  if (!TABLE || !IMAGE) return bad(500, 'server misconfigured');

  const out = await ddb.send(new GetCommand({ TableName: TABLE, Key: { taskId } }));
  const task = out.Item as any;
  if (!task) return bad(404, `unknown task ${taskId}`);
  if (task.status !== 'working' || !task.jobId) {
    return bad(409, `task ${taskId} is ${task.status} — only funded (working) tasks get a sandbox`);
  }

  // Operator auth: same deliver-key scheme as web3-deliver/submit.
  // Internal auto-boot skips it (IAM-gated Invoke is the auth).
  if (!internalCall) {
    const signer = await recoverMessageAddress({
      message: deliverMessage(taskId, 'boot', String(nonce)),
      signature: providerSig as `0x${string}`,
    });
    if (signer.toLowerCase() !== String(providerAddress).toLowerCase()) {
      return bad(403, 'providerSig mismatch');
    }
  }

  // Single Meta key for VM inference (meta-only images). Legacy MODAL passes
  // through only when configured (old images).
  const providerKey = process.env.PROVIDER_API_KEY ?? '';
  const modalKey = process.env.MODAL_API_KEY ?? '';
  if (!providerKey) return bad(500, 'server misconfigured: inference keys missing');

  // One sandbox per wallet: reuse the buyer's live VM, or resume a suspended
  // one (files survive suspend) — boot new only when neither exists.
  const buyer = String(task.buyer ?? '').toLowerCase();
  const ownerId = buyer ? `wallet-${buyer.slice(0, 10)}` : `task-${taskId.slice(0, 8)}`;
  if (task.vm?.vmId && !task.vm.terminatedAt && !task.vm.suspendedAt) {
    return ok({ reused: true, vmId: task.vm.vmId, endpoint: task.vm.endpoint });
  }
  if (buyer) {
    const live = await findLiveVmForBuyer(buyer);
    if (live?.vm && live.taskId !== taskId) {
      task.vm = { ...live.vm };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: task }));
      return ok({ reused: true, vmId: live.vm.vmId, endpoint: live.vm.endpoint });
    }
    const susp = await findSuspendedVmForBuyer(buyer);
    if (susp?.vm) {
      const anchor = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { taskId: susp.taskId } }))).Item as any;
      if (anchor?.vm) {
        await resumeVm(anchor);
        const fresh = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { taskId: susp.taskId } }))).Item as any;
        task.vm = { ...(fresh?.vm ?? susp.vm) };
        delete (task.vm as any).suspendedAt;
        await ddb.send(new PutCommand({ TableName: TABLE, Item: task }));
        return ok({ resumed: true, vmId: task.vm.vmId, endpoint: task.vm.endpoint });
      }
    }
  }
  let vmId = '';
  try {
    const fundedSeconds = Number(task.quote?.fundedSeconds ?? 360);
    const run: any = await vm.send(
      new RunMicrovmCommand({
        imageIdentifier: IMAGE,
        runHookPayload: JSON.stringify({ ownerId, computerId: taskId }),
        ingressNetworkConnectors: [CONN('ALL_INGRESS')],
        egressNetworkConnectors: [CONN('INTERNET_EGRESS')],
        idlePolicy: { autoResumeEnabled: true, maxIdleDurationSeconds: 900, suspendedDurationSeconds: 604800 },
        maximumDurationInSeconds: Math.max(7200, fundedSeconds + 3600),
      }),
    );
    vmId = run.microvmIdentifier ?? run.microvmId ?? run.microvmArn ?? '';
    if (!vmId) throw new Error('no microvm id in Run output');

    let endpoint = '';
    for (let i = 0; i < 24; i++) {
      const got: any = await vm.send(new GetMicrovmCommand({ microvmIdentifier: vmId }));
      endpoint = got.endpoint ?? '';
      if (endpoint && /running/i.test(JSON.stringify(got.state))) break;
      await sleep(15000);
    }
    if (!endpoint) throw new Error('VM never reached RUNNING');

    const tok: any = await vm.send(new CreateMicrovmAuthTokenCommand({ microvmIdentifier: vmId, allowedPorts: [{ port: 8080 }], expirationInMinutes: 60 }));
    const token = tok?.authToken?.['X-aws-proxy-auth'] ?? '';
    if (!token) throw new Error('auth token mint failed');

    const hook = await vmFetch(endpoint, token, '/hooks/run', {
      method: 'POST',
      body: JSON.stringify({ ownerId, computerId: taskId, secrets: { ...(modalKey ? { MODAL_API_KEY: modalKey } : {}), PROVIDER_API_KEY: providerKey }, usageToken: `crewtopia-${taskId.slice(0, 8)}`, apiUrl: 'https://example.com' }),
    });
    console.log(`[sandbox] hook keys: PROVIDER=${providerKey.length} chars${modalKey ? ` MODAL=${modalKey.length} chars` : ''} -> ${hook.status} ${hook.text.slice(0, 200)}`);
    if (hook.status !== 200 || hook.json?.initialized !== true) {
      throw new Error(`hooks/run failed: ${hook.status} ${hook.text.slice(0, 200)}`);
    }

    // Pre-grant tool permissions for headless builds. The guest defaults to
    // ask-for-approval (human interactive); a hired team has no human in the
    // loop, so we seed broad allows. Scoped to disposable build VMs only —
    // narrow these patterns when briefs get adversarial (v2 hardening).
    // PUT replaces the rule list; unknown permissions still fall back to ask.
    const perms = await vmFetch(endpoint, token, '/permissions', {
      method: 'PUT',
      body: JSON.stringify({ rules: [
        { permission: 'shell', pattern: '*', action: 'allow' },
        { permission: 'write', pattern: '*', action: 'allow' },
      ] }),
    });
    console.log(`[sandbox] permissions seed -> ${perms.status}`);
    if (perms.status !== 200) throw new Error(`/permissions seed failed: ${perms.status} ${perms.text.slice(0, 200)}`);

    const smoke = await vmFetch(endpoint, token, '/task', {
      method: 'POST',
      body: JSON.stringify({ text: `You are the build agent for hired task: ${task.brief.slice(0, 300)}. Reply with exactly: SANDBOX READY. No tools.`, ownerId }),
    });
    console.log(`[sandbox] smoke /task -> ${smoke.status} ${(smoke.text ?? '').slice(0, 120)}`);
    if (smoke.status !== 202 && smoke.status !== 200) {
      throw new Error(`/task rejected: ${smoke.status} ${smoke.text.slice(0, 200)}`);
    }
    const runId = smoke.json?.runId ?? smoke.json?.run_id ?? smoke.json?.id ?? '';

    // Placeholder preview: serve the workspace on 5173 immediately so every
    // funded task has a live URL from birth. Real builds replace the content
    // in place — same port, same relay, no re-plumbing.
    const serve = await vmFetch(endpoint, token, '/task', {
      method: 'POST',
      body: JSON.stringify({
        text: `Serve /srv/computer/workspace on port 5173 in the background and keep it running. The VM has node but no python3 — use e.g. 'nohup npx -y serve /srv/computer/workspace -l 5173 >/tmp/serve.log 2>&1 &' or a node one-liner. First verify with 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/' until it prints 200, then reply with exactly: SERVING. Use tools, no questions.`,
        ownerId,
      }),
    });
    console.log(`[sandbox] serve /task -> ${serve.status} ${(serve.text ?? '').slice(0, 120)}`);
    let serving = false;
    for (let i = 0; i < 78; i++) {
      await sleep(10000);
      const probe = await vmFetch(endpoint, token, '/dev/?port=5173', { method: 'GET' });
      if (probe.status === 200) {
        serving = true;
        console.log(`[sandbox] dev server up after ~${(i + 1) * 10}s`);
        break;
      }
    }
    if (!serving) throw new Error('placeholder preview never came up on 5173');

    task.vm = { vmId, endpoint, bootedAt: new Date().toISOString(), smokeRunId: runId, preview: true };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: task }));
    // Sandbox-live notice (no link — preview is minted on demand via preview-link).
    if (task.viaEmber && task.buyer) {
      await appendMessages(task.buyer, 'ember', [
        {
          role: 'assistant',
          text: `Sandbox is live — ${task.quote?.displayName ?? 'Dev Crew'} is set up and ready. Tell the crew what to build first, and ask me for the preview link whenever you want to see it.`,
          at: new Date().toISOString(),
        },
      ]).catch(() => {});
    }
    return ok({ taskId, vmId, endpoint, smokeRunId: runId, preview: true, note: 'sandbox live, placeholder preview on 5173; token held server-side, never returned' });
  } catch (e) {
    // Never leak a billing VM.
    if (vmId) {
      try {
        await vm.send(new TerminateMicrovmCommand({ microvmIdentifier: vmId }));
      } catch { /* already gone */ }
    }
    return bad(500, `sandbox boot failed: ${e instanceof Error ? e.message : String(e)}`);
  }
};
