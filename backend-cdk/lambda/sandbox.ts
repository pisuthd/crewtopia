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
import { S3Client, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { resumeVm } from './a2a/relay';

// Delivery file helpers (folded in from delivery-files.ts): source-zip
// handoff through a private bucket. VM uploads via presigned PUT
// (usage-token gated); downloads via presigned GET minted here or at
// web3-deliver submit (7 days). No public policy.
const REGION = process.env.AWS_REGION ?? 'ap-southeast-1';
const s3 = new S3Client({ region: REGION });

export const deliveryKeyFor = (taskId: string) => `deliveries/${taskId}.zip`;

function deliveryBucket(): string {
  const b = process.env.DELIVERIES_BUCKET ?? '';
  if (!b) throw new Error('server misconfigured: deliveries bucket missing');
  return b;
}

/** Presigned PUT (15 min) for the VM deliver tool. */
export async function mintDeliveryPutUrl(taskId: string): Promise<{ url: string; key: string }> {
  const key = deliveryKeyFor(taskId);
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: deliveryBucket(), Key: key, ContentType: 'application/zip' }), { expiresIn: 900 });
  return { url, key };
}

/** True when the crew uploaded a delivery zip for this task. */
export async function deliveryExists(taskId: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: deliveryBucket(), Key: deliveryKeyFor(taskId) }));
    return true;
  } catch {
    return false;
  }
}

/** Presigned GET (7 days) for the buyer. */
export async function mintDeliveryGetUrl(taskId: string, expiresIn = 7 * 24 * 3600): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: deliveryBucket(), Key: deliveryKeyFor(taskId) }), { expiresIn });
}

// Phase 4: provision-on-demand. Team-operator-signed POST boots a disposable
// microVM for a funded (WORKING) task: run → wait → token → /hooks/run with
// the dev inference keys → smoke /task → store vmId on the task. Preview
// relay (live dev port) lands next; real builds land after.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TASKS_TABLE ?? '';
const IMAGE = process.env.COMPUTER_IMAGE_ARN ?? '';
const vm = new LambdaMicrovmsClient({ region: REGION });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CONN = (name: string) => `arn:aws:lambda:${REGION}:aws:network-connector:aws-network-connector:${name}`;

function deliverMessage(taskId: string, action: string, nonce: string): string {
  return `Crewtopia deliver v1\ntask: ${taskId}\naction: ${action}\nnonce: ${nonce}`;
}

/** Usage-token from body or VM header (computer sends it as X-computer-usage-token). */
function syncToken(p: any, event: any): string {
  return String(
    p.token ?? event.headers?.['X-computer-usage-token'] ?? event.headers?.['x-computer-usage-token'] ?? '',
  );
}

/** Traversal-safe workspace path, or null. Mirrors the VM-side pull guards. */
function cleanSyncPath(raw: unknown): string | null {
  const p = String(raw ?? '');
  if (!p || p.length > 512) return null;
  const segs = p.split('/').filter((s) => s !== '');
  if (segs.length === 0 || segs.length > 32) return null;
  if (segs.some((s) => s === '.' || s === '..' || s.startsWith('.'))) return null;
  return segs.join('/');
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

/**
 * Start a hired crew inside the renter's wallet sandbox: waits for the VM,
 * then posts one opening run per roster member (botName + roster + system
 * brief + rent-namespaced conversationId). Fire-and-forget per member —
 * replies land in VM transcripts; the buyer continues via crew-chat.
 */
async function startCrewSession(taskId: string, wallet: string): Promise<{ ok: boolean; error?: string }> {
  if (!taskId) return { ok: false, error: 'needs taskId' };
  const { getSandbox } = await import('./sandboxStore');
  const { vmToken } = await import('./a2a/vm');
  const out = await ddb.send(new GetCommand({ TableName: TABLE, Key: { taskId } }));
  const task = out.Item as any;
  if (!task) return { ok: false, error: `unknown task ${taskId}` };
  if (!task.buyer || String(task.buyer).toLowerCase() !== wallet) {
    return { ok: false, error: 'task belongs to a different wallet' };
  }
  const roster: Array<{ role: string; name: string; title: string; brief: string }> =
    Array.isArray(task.roster) && task.roster.length > 0 ? task.roster : [];
  if (roster.length === 0) return { ok: false, error: 'task has no crew roster' };
  // Wait for the wallet sandbox (boot-sandbox runs alongside this). Verify
  // RUNNING via the platform, not just the record — records go stale.
  let rec = await getSandbox(wallet).catch(() => null);
  let liveEndpoint: string | null = null;
  for (let i = 0; i < 72 && !liveEndpoint; i++) {
    if (rec?.vm?.vmId && rec.vm.endpoint && !rec.vm.suspendedAt && !rec.vm.terminatedAt) {
      try {
        const got: any = await vm.send(new GetMicrovmCommand({ microvmIdentifier: rec.vm.vmId }));
        if (got.endpoint && /running/i.test(JSON.stringify(got.state))) {
          liveEndpoint = got.endpoint;
          break;
        }
      } catch {
        // keep waiting
      }
    }
    await sleep(10000);
    rec = await getSandbox(wallet).catch(() => null);
  }
  if (!rec?.vm?.vmId || !liveEndpoint) {
    return { ok: false, error: 'sandbox not live — boot it first' };
  }
  const liveEndpointChecked: string = liveEndpoint;
  let token: string;
  try {
    token = await vmToken(rec.vm!.vmId);
  } catch (e) {
    return { ok: false, error: `VM auth failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const verifiedEndpoint: string = liveEndpointChecked;
  const vmRoster = roster.map((m) => ({ id: m.role, name: m.name, role: m.title }));
  // Model routing: team lead (roster[0], any role name) runs the catalog
  // default (meta/muse-ember-1.0); every other member runs the cheaper spark.
  const leadRole = roster[0]?.role;
  // Dev-only DONE criteria (serve 5173 + deliver) must not leak onto other
  // teams: a custom crew ordered to "ship the app" invents work nobody
  // asked for. Missing teamId = back-compat dev hire.
  const rawTeamId = String(task.teamId ?? '');
  const isDevTeam = rawTeamId === '' || rawTeamId === 'dev-crew' || rawTeamId === 'crewtopia-dev-crew';
  // UI hires (viaEmber) get human-voiced kickoffs: the protocol-dense A2A
  // text (rental UUIDs, task_id, HOLD/DONE tokens, port/deliver mandates)
  // is agent grounding that reads as noise in human threads. Protocol
  // details live in the invisible system briefs; the visible kickoff stays
  // plain. A2A text below is byte-identical to before — don't touch it.
  const viaUI = !!task.viaEmber;
  const leadName = roster[0]?.name ?? 'the lead';
  const noBriefLead = '(no brief — ask the buyer what they want first, and have everyone hold until they answer)';
  const noBriefMember = '(no brief — the lead will brief you; if the lead has nothing for you yet, reply HOLD and stop)';
  const uiNoBriefLead = 'no brief yet — ask the buyer what they want, plainly';
  const uiNoBriefMember = `${leadName} hasn't briefed you yet — say a short hello and stand by`;
  // Double-start guard: the flip path and the supervisor can both fire
  // start-crew. Re-read — roles with tracked runs already said hello.
  // (Filtering hides dupes from chat anyway; this saves the model calls.)
  const fresh = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { taskId } }))).Item as any;
  const startedRoles = new Set(Object.keys(fresh?.crewRuns ?? {}));
  const pending = roster.filter((m) => !startedRoles.has(m.role));
  if (pending.length === 0) {
    console.log(`[sandbox] start-crew ${taskId}: all roles already started — skipping`);
    return { ok: true };
  }
  const started: Array<{ role: string; runId: string }> = [];
  await Promise.all(
    pending.map(async (m) => {
      const isLead = roster[0] && m.role === roster[0].role;
      const briefText = task.brief || (isLead ? noBriefLead : noBriefMember);
      const uiBrief = task.brief || (isLead ? uiNoBriefLead : uiNoBriefMember);
      const teamList = roster.map((r) => `${r.name} (${r.title})`).join(', ');
      const text = viaUI
        ? isLead
          ? `You're hired: ${uiBrief}. Team: ${teamList}. Coordinate them with @mentions and deliver.${isDevTeam && task.brief ? ' Build it, serve it for preview, and deliver when done.' : ''}`
          : `You're ${m.name}, ${m.title}. ${uiBrief}.`
        : isLead
          ? isDevTeam
            ? `Rental ${taskId} is now FUNDED and live. Brief: ${briefText}. Roster: ${teamList}. You lead: split the work across the roster with @mentions and drive it to done. Do not reply conversationally — work until: the app serves 200 on port 5173 AND you ran the deliver tool with task_id "${taskId}" AND shared the download link. Only then write DONE plus a one-line summary.`
            : `Rental ${taskId} is now FUNDED and live. Brief: ${briefText}. Roster: ${teamList}. You lead: triage the brief, split the work across the roster with @mentions and drive it to done. Do not reply conversationally — work until the brief's goal is verifiably met, then write DONE plus a one-line summary for the buyer. Only build a site, serve a port, or run the deliver tool if the brief actually asks for it.`
          : isDevTeam
            ? `Rental ${taskId} is now FUNDED and live. Brief: ${briefText}. Do your part, report results back to the lead in-thread, then stop. Do not reply conversationally — only real progress and the final handoff.`
            : `Rental ${taskId} is now FUNDED and live. Brief: ${briefText}. Do your part per your role instructions, report results back to the lead in-thread, then stop. Do not reply conversationally — only real progress and the final handoff. Only build, serve, or deliver anything if the brief calls for it.`;
      const body: any = {
        text: String(text).slice(0, 4000),
        kind: 'kickoff',
        botName: m.name,
        roster: vmRoster,
        system: m.brief,
        ownerId: wallet,
        conversationId: `rent:${taskId}#${m.role}`,
      };
      if (m.role !== leadRole) {
        body.provider = 'meta';
        body.model = 'muse-spark-1.3-contributor';
      }
      const r = await vmFetch(verifiedEndpoint, token, '/task', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      if (r && (r.status === 202 || r.status === 200)) {
        const j = (await r.json().catch(() => ({}))) as any;
        const rid = j?.runId ?? j?.run_id ?? j?.id;
        if (rid) started.push({ role: m.role, runId: String(rid) });
      }
    }),
  );
  console.log(`[sandbox] start-crew ${taskId}: ${started.map((s) => s.role).join(',') || 'none started'}`);
  if (started.length === 0) return { ok: false, error: 'no crew runs started' };
  // Fix D: per-role atomic tracking (first writer wins) — never a whole-task
  // read-modify-write that wipes concurrent writers' roles.
  try {
    const { trackCrewRun } = await import('./a2a/store');
    const at = new Date().toISOString();
    await Promise.all(started.map((s) => trackCrewRun(taskId, s.role, { runId: s.runId, startedAt: at, nudges: 0 })));
  } catch (e) {
    console.error(`[sandbox] start-crew ${taskId}: run tracking save failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Mid-rental join: the already-running lead's roster is stale (their
  // kickoff predates the newcomer). Tell them in-thread so they brief the
  // joiner and fold them into the plan. Fresh kickoffs (lead among started)
  // already carry the full roster — no nudge needed.
  try {
    const lead = roster[0];
    const leadWasRunning = !!lead?.role && startedRoles.has(lead.role);
    const newcomers = started.filter((s) => s.role !== lead?.role);
    if (leadWasRunning && newcomers.length > 0) {
      const who = newcomers
        .map((s) => {
          const m = roster.find((x) => x.role === s.role);
          return m ? `${m.name} (${m.title}): ${String(m.brief).slice(0, 500)}` : s.role;
        })
        .join('; ');
      const announced = await vmFetch(verifiedEndpoint, token, '/task', {
        method: 'POST',
        body: JSON.stringify({
          text: `New member(s) joined the crew mid-rental: ${who}. Brief them in-thread and fold them into the plan. Do not restart — continue from this thread's history.`,
          botName: lead.name,
          roster: vmRoster,
          system: lead.brief,
          ownerId: wallet,
          conversationId: `rent:${taskId}#${lead.role}`,
        }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      const aj = announced && announced.status === 202 ? ((await announced.json().catch(() => ({}))) as any) : null;
      const nid = aj?.runId ?? aj?.run_id ?? aj?.id;
      if (nid) {
        // Fix D: overwrite just the lead's entry (nudge replaces the run).
        const { getTask, setCrewRun } = await import('./a2a/store');
        const cur = await getTask(taskId).catch(() => null);
        const prev = (cur as any)?.crewRuns?.[lead.role];
        await setCrewRun(taskId, lead.role, {
          runId: String(nid),
          startedAt: new Date().toISOString(),
          nudges: prev?.nudges ?? 0,
          cursor: 0,
        }).catch(() => null);
        console.log(`[sandbox] start-crew ${taskId}: lead nudged about ${newcomers.map((s) => s.role).join(',')}`);
      }
    }
  } catch (e) {
    // Best-effort: the newcomer still messages the lead via team tools.
    console.error(`[sandbox] start-crew ${taskId}: lead nudge failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: true };
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

  // Per-wallet sandbox provisioning (option B, no rental): internal IAM-gated
  // Invoke from the app boot route. Async — boot/resume exceed the 29s
  // gateway clock; callers poll record state. computerId is wallet-stable so
  // terminate → new VM restores the same backup.
  const raw = event as any;
  // terminate-sandbox / terminate-task-vm: async flush-first VM kill, fired
  // by the app terminate route. The route 202s immediately (29s gateway
  // clock); this runs the slow backup flush + platform terminate here.
  if (raw.internal === true && !raw.httpMethod && (raw.action === 'terminate-sandbox' || raw.action === 'terminate-task-vm')) {
    const { terminateSandboxVm, getSandbox } = await import('./sandboxStore');
    const { flushVmBackup, terminateVm } = await import('./a2a/vm');
    try {
      if (raw.action === 'terminate-sandbox') {
        const rec = await getSandbox(String(raw.wallet ?? '').toLowerCase()).catch(() => null);
        if (rec?.vm?.vmId && !rec.vm.terminatedAt && rec.vm.endpoint && !rec.vm.suspendedAt) {
          try {
            await flushVmBackup(rec.vm.vmId, rec.vm.endpoint);
            console.log(`[sandbox] pre-terminate flush ok (computer ${rec.computerId})`);
          } catch (e) {
            console.error(`[sandbox] pre-terminate flush failed, terminating anyway: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (rec) await terminateSandboxVm(rec).catch((e: Error) => console.error(`[sandbox] async terminate failed: ${e.message}`));
      } else {
        const { getTask, putTask } = await import('./a2a/store');
        const task = await getTask(String(raw.task_id ?? '')).catch(() => null);
        if (task?.vm?.vmId && !task.vm.terminatedAt && task.vm.endpoint && !task.vm.suspendedAt) {
          try {
            await flushVmBackup(task.vm.vmId, task.vm.endpoint);
            console.log(`[sandbox] pre-terminate flush ok (task ${task.taskId})`);
          } catch (e) {
            console.error(`[sandbox] pre-terminate flush failed, terminating anyway: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (task && task.vm && !task.vm.terminatedAt) {
          await terminateVm(task).catch(() => null);
          await putTask(task).catch(() => null);
        }
      }
    } catch (e) {
      console.error(`[sandbox] async terminate error: ${e instanceof Error ? e.message : String(e)}`);
    }
    return ok({ terminated: true });
  }
  if (raw.internal === true && !raw.httpMethod && (raw.action === 'boot-sandbox' || raw.action === 'resume-sandbox' || raw.action === 'start-crew')) {
    const wallet = String(raw.wallet ?? '').toLowerCase();
    console.log(`[sandbox] internal action=${raw.action} wallet=${wallet.slice(0, 10)}…`);
    if (!wallet) return bad(400, 'needs { wallet }');
    if (raw.action === 'start-crew') {
      const started = await startCrewSession(String(raw.taskId ?? ''), wallet);
      return started.ok ? ok({ started: true, taskId: raw.taskId }) : bad(500, started.error ?? 'crew start failed');
    }
    try {
      const { getSandbox, putSandbox, computerIdFor, usageTokenFor, resumeSandboxVm } = await import('./sandboxStore');
      const now = new Date().toISOString();
      let rec = await getSandbox(wallet).catch(() => null);
      if (!rec) {
        // Shell only — NOT persisted yet. The CAS claim below performs the
        // single atomic write, so concurrent boots can't double-provision.
        rec = { wallet, computerId: computerIdFor(wallet), status: 'terminated', createdAt: now, updatedAt: new Date(0).toISOString() };
      }
      if (raw.action === 'resume-sandbox') {
        if (!rec.vm?.vmId || rec.vm.terminatedAt || !rec.vm.suspendedAt) {
          return ok({ state: rec.vm?.suspendedAt ? 'suspended' : 'none', note: 'nothing to resume' });
        }
        await resumeSandboxVm(rec);
        return ok({ state: 'live', vmId: rec.vm!.vmId, endpoint: rec.vm!.endpoint });
      }
      // boot-sandbox
      if (rec.vm?.vmId && rec.vm.endpoint && !rec.vm.suspendedAt && !rec.vm.terminatedAt) {
        // Records go stale (platform reaps VMs out-of-band) — verify before
        // trusting, or every boot becomes a no-op returning a dead VM.
        let running = false;
        try {
          const got: any = await vm.send(new GetMicrovmCommand({ microvmIdentifier: rec.vm.vmId }));
          running = !!(got.endpoint && /running/i.test(JSON.stringify(got.state)));
          if (running && got.endpoint !== rec.vm.endpoint) {
            rec.vm.endpoint = got.endpoint;
            await putSandbox(rec).catch(() => {});
          }
        } catch {
          running = false;
        }
        if (running) {
          return ok({ state: 'live', reused: true, vmId: rec.vm.vmId, endpoint: rec.vm.endpoint });
        }
        console.log(`[sandbox] record claimed live VM ${rec.vm.vmId} but it is gone — re-provisioning`);
        rec.vm.terminatedAt = new Date().toISOString();
        rec.status = 'terminated';
        await putSandbox(rec);
      }
      if (rec.status === 'booting' && !rec.vm?.vmId && Date.now() - new Date(rec.updatedAt).getTime() < 5 * 60_000) {
        // Another provision is already in flight — don't start a second one.
        return ok({ state: 'booting' });
      }
      if (rec.vm?.vmId && rec.vm.suspendedAt && !rec.vm.terminatedAt) {
        // Resume can fail when the platform already reaped the VM — fall
        // through to a fresh provision instead of stranding the record.
        try {
          await resumeSandboxVm(rec);
          return ok({ state: 'live', resumed: true, vmId: rec.vm!.vmId, endpoint: rec.vm!.endpoint });
        } catch (e) {
          console.error(`[sandbox] resume failed, re-provisioning: ${e instanceof Error ? e.message : String(e)}`);
          rec.vm.terminatedAt = new Date().toISOString();
          delete rec.vm.suspendedAt;
          rec.status = 'terminated';
          await putSandbox(rec);
        }
      }
      // Atomic claim: concurrent boots race here — only the winner provisions.
      // Loser sees ConditionalCheckFailed and reports booting. Stale claims
      // (>5 min, crashed provisioner) don't block: the cutoff lets one through.
      // NOTE: sandbox table (PK wallet), NOT the tasks table.
      const sandboxTable = process.env.SANDBOX_TABLE ?? '';
      if (!sandboxTable) throw new Error('server misconfigured: SANDBOX_TABLE is not set');
      rec.status = 'booting';
      rec.updatedAt = new Date().toISOString();
      try {
        const { PutCommand: PutCmd } = await import('@aws-sdk/lib-dynamodb');
        await ddb.send(
          new PutCmd({
            TableName: sandboxTable,
            Item: rec,
            ConditionExpression: 'attribute_not_exists(#w) OR #s <> :b OR #u < :c',
            ExpressionAttributeNames: { '#w': 'wallet', '#s': 'status', '#u': 'updatedAt' },
            ExpressionAttributeValues: { ':b': 'booting', ':c': new Date(Date.now() - 5 * 60_000).toISOString() },
          }),
        );
      } catch (e) {
        if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
          console.log(`[sandbox] boot already in flight for ${wallet.slice(0, 10)} — deduping`);
          return ok({ state: 'booting' });
        }
        throw e;
      }
      const computerId = rec.computerId;
      // Platform auto-suspend TERMINATES instead of parking (observed) — keep
      // idle longer than max duration so it never triggers; parking is
      // explicit flush + terminate + boot.
      const idleSeconds = Number(process.env.SANDBOX_IDLE_SECONDS ?? 28800) || 28800;
      const ownerId = `wallet-${wallet.slice(2, 12)}`;
      let vmId = '';
      try {
        const run: any = await vm.send(
          new RunMicrovmCommand({
            imageIdentifier: IMAGE,
            runHookPayload: JSON.stringify({ ownerId, computerId }),
            ingressNetworkConnectors: [CONN('ALL_INGRESS')],
            egressNetworkConnectors: [CONN('INTERNET_EGRESS')],
            idlePolicy: { autoResumeEnabled: true, maxIdleDurationSeconds: idleSeconds, suspendedDurationSeconds: 604800 },
            // MicroVM cap is 8h; idle-park keeps the VM alive across it via suspend/resume.
            maximumDurationInSeconds: 28800,
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
        // Provisioning handshake with backoff: the platform reports RUNNING +
        // endpoint before node finishes loading (skills scan, keystore), so
        // the first knocks can fail on a HEALTHY vm. Never terminate on a
        // single failure — retry ~3 min, terminate only on sustained failure
        // (the catch below logs it, so CloudWatch distinguishes our kills
        // from platform reaps).
        let provisioned = false;
        let lastErr = 'unknown';
        const pt0 = Date.now();
        while (Date.now() - pt0 < 180_000) {
          try {
            const hook = await vmFetch(endpoint, token, '/hooks/run', {
              method: 'POST',
              body: JSON.stringify({
                ownerId,
                computerId,
                secrets: { ...(process.env.MODAL_API_KEY ? { MODAL_API_KEY: process.env.MODAL_API_KEY } : {}), PROVIDER_API_KEY: process.env.PROVIDER_API_KEY ?? '', ...(process.env.ELEVENLABS_API_KEY ? { ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY } : {}) },
                usageToken: usageTokenFor(computerId),
                apiUrl: process.env.COMPUTER_API_URL ?? 'https://example.com',
                workspace: { bucket: deliveryBucket(), prefix: 'backups/' },
              }),
            });
            if (hook.status !== 200 || hook.json?.initialized !== true) {
              throw new Error(`hooks/run failed: ${hook.status} ${hook.text.slice(0, 200)}`);
            }
            const perms = await vmFetch(endpoint, token, '/permissions', {
              method: 'PUT',
              body: JSON.stringify({ rules: [
                { permission: 'shell', pattern: '*', action: 'allow' },
                { permission: 'write', pattern: '*', action: 'allow' },
                { permission: 'edit', pattern: '*', action: 'allow' },
                { permission: 'read', pattern: '*', action: 'allow' },
                { permission: 'read_file', pattern: '*', action: 'allow' },
                { permission: 'list', pattern: '*', action: 'allow' },
                { permission: 'glob', pattern: '*', action: 'allow' },
                { permission: 'grep', pattern: '*', action: 'allow' },
                { permission: 'skill', pattern: '*', action: 'allow' },
                { permission: 'task', pattern: '*', action: 'allow' },
                { permission: 'webfetch', pattern: '*', action: 'allow' },
                { permission: 'websearch', pattern: '*', action: 'allow' },
                { permission: 'grounded_search', pattern: '*', action: 'allow' },
                { permission: 'deliver', pattern: '*', action: 'allow' },
              ] }),
            });
            if (perms.status !== 200) throw new Error(`/permissions seed failed: ${perms.status}`);
            const smoke = await vmFetch(endpoint, token, '/task', {
              method: 'POST',
              body: JSON.stringify({ text: `You are the sandbox agent for ${ownerId}. Reply with exactly: SANDBOX READY. No tools.`, ownerId }),
            });
            if (smoke.status !== 202 && smoke.status !== 200) throw new Error(`/task rejected: ${smoke.status}`);
            provisioned = true;
            break;
          } catch (e) {
            lastErr = e instanceof Error ? e.message : String(e);
            await sleep(15000);
          }
        }
        if (!provisioned) throw new Error(`provisioning failed after 3m: ${lastErr}`);
        const serve = await vmFetch(endpoint, token, '/task', {
          method: 'POST',
          body: JSON.stringify({
            text: `Serve /srv/computer/workspace on port 5173 in the background and keep it running. Use e.g. 'nohup npx -y serve /srv/computer/workspace -l 5173 >/tmp/serve.log 2>&1 &' or a node one-liner. First verify with 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/' until it prints 200, then reply with exactly: SERVING. Use tools, no questions.`,
            ownerId,
          }),
        });
        void serve;
        rec.vm = { vmId, endpoint, bootedAt: new Date().toISOString() };
        rec.status = 'live';
        await putSandbox(rec);
        return ok({ state: 'live', vmId, endpoint, note: 'sandbox live, placeholder on 5173; token held server-side, never returned' });
      } catch (e) {
        if (vmId) {
          try {
            await vm.send(new TerminateMicrovmCommand({ microvmIdentifier: vmId }));
          } catch { /* already gone */ }
        }
        console.error(`[sandbox] internal ${raw.action} failed: ${e instanceof Error ? e.message : String(e)}`);
        return bad(500, `sandbox boot failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } catch (e) {
      console.error(`[sandbox] internal ${raw.action} failed: ${e instanceof Error ? e.message : String(e)}`);
      return bad(500, e instanceof Error ? e.message : String(e));
    }
  }

  // Delivery upload URL (VM → S3): usage-token gated, presigned PUT 15 min.
  // The VM proves the per-boot token minted at /hooks/run time.
  if ((event.resource ?? '').includes('/delivery/put-url')) {
    let p: any = {};
    try {
      p = JSON.parse(event.body ?? '{}');
    } catch {
      return bad(400, 'body must be JSON');
    }
    const computerId = String(p.computerId ?? '');
    const token = syncToken(p, event);
    if (!computerId || !token) return bad(400, 'needs { computerId, token }');
    if (token !== `crewtopia-${computerId.slice(0, 8)}`) return bad(403, 'bad usage token');
    // Hired work from a personal sandbox passes taskId explicitly; the
    // delivery is keyed by rental so submit/status keep working. The task
    // must belong to the sandbox owner.
    const explicitTaskId = p.taskId ? String(p.taskId) : '';
    const keyTaskId = explicitTaskId || computerId;
    const tout = await ddb.send(new GetCommand({ TableName: TABLE, Key: { taskId: keyTaskId } }));
    const task = tout.Item as any;
    if (!task || (task.status !== 'working' && task.status !== 'funding')) {
      return bad(404, 'no live rental for this computer');
    }
    if (explicitTaskId) {
      const { findSandboxByComputerId } = await import('./sandboxStore');
      const sb = await findSandboxByComputerId(computerId).catch(() => null);
      if (!sb || !task.buyer || String(task.buyer).toLowerCase() !== String(sb.wallet).toLowerCase()) {
        return bad(403, 'task belongs to a different wallet');
      }
    }
    try {
      return ok(await mintDeliveryPutUrl(keyTaskId));
    } catch (e) {
      return bad(500, e instanceof Error ? e.message : 'mint failed');
    }
  }

  // Delivery download URL (VM → buyer): usage-token gated, presigned GET 7 days.
  // Same per-boot token as put-url. No status gate — submitted rentals need
  // downloads most. The crew shares this URL with the buyer directly in chat.
  if ((event.resource ?? '').includes('/delivery/get-url')) {
    let p: any = {};
    try {
      p = JSON.parse(event.body ?? '{}');
    } catch {
      return bad(400, 'body must be JSON');
    }
    const computerId = String(p.computerId ?? '');
    const token = syncToken(p, event);
    if (!computerId || !token) return bad(400, 'needs { computerId, token }');
    if (token !== `crewtopia-${computerId.slice(0, 8)}`) return bad(403, 'bad usage token');
    const explicitTaskId = p.taskId ? String(p.taskId) : '';
    const keyTaskId = explicitTaskId || computerId;
    const out = await ddb.send(new GetCommand({ TableName: TABLE, Key: { taskId: keyTaskId } }));
    const task = out.Item as any;
    if (!task) return bad(404, 'unknown computer');
    if (explicitTaskId && task.buyer) {
      const { findSandboxByComputerId } = await import('./sandboxStore');
      const sb = await findSandboxByComputerId(computerId).catch(() => null);
      if (!sb || String(task.buyer).toLowerCase() !== String(sb.wallet).toLowerCase()) {
        return bad(403, 'task belongs to a different wallet');
      }
    }
    if (!(await deliveryExists(keyTaskId).catch(() => false))) {
      return bad(404, 'no delivery uploaded yet — the crew must run the deliver tool first');
    }
    try {
      return ok({ url: await mintDeliveryGetUrl(keyTaskId) });
    } catch (e) {
      return bad(500, e instanceof Error ? e.message : 'mint failed');
    }
  }

  // Workspace backup (VM ↔ S3): usage-token gated, same per-boot token as
  // delivery. The computer pushes incremental file sets on suspend/terminate
  // and pulls missing files on boot — per-file presigned URLs, manifest kept
  // on the VM. `.wayfind/` (keystore) never leaves the VM. Keys:
  // backups/{computerId}/{path}. Retention: bucket lifecycle (30d).
  const backupKeyFor = (computerId: string, path: string) => `backups/${computerId}/${path}`;
  if ((event.resource ?? '').includes('/sync/upload-urls')) {
    let p: any = {};
    try {
      p = JSON.parse(event.body ?? '{}');
    } catch {
      return bad(400, 'body must be JSON');
    }
    const taskId = String(p.computerId ?? '');
    const token = syncToken(p, event);
    if (!taskId || !token) return bad(400, 'needs { computerId, token, files }');
    if (token !== `crewtopia-${taskId.slice(0, 8)}`) return bad(403, 'bad usage token');
    const files = Array.isArray(p.files) ? p.files : [];
    console.log(`[sandbox] sync/upload-urls computer=${taskId} files=${files.length}`);
    if (files.length > 20000) return bad(400, 'too many files (max 20000)');
    const out = await ddb.send(new GetCommand({ TableName: TABLE, Key: { taskId } }));
    if (!out.Item) {
      // Per-wallet sandbox (option B): computerId is wallet-stable, no task row.
      const { findSandboxByComputerId } = await import('./sandboxStore');
      const sb = await findSandboxByComputerId(taskId).catch(() => null);
      if (!sb) return bad(404, 'unknown computer');
    }
    try {
      const urls: Record<string, string> = {};
      for (const f of files) {
        const path = cleanSyncPath(f?.path);
        const size = Number(f?.size ?? 0);
        if (!path || !(size > 0) || size > 25 * 1024 * 1024) continue;
        urls[path] = await getSignedUrl(
          s3,
          new PutObjectCommand({ Bucket: deliveryBucket(), Key: backupKeyFor(taskId, path) }),
          { expiresIn: 900 },
        );
      }
      return ok({ urls });
    } catch (e) {
      return bad(500, e instanceof Error ? e.message : 'mint failed');
    }
  }
  if ((event.resource ?? '').includes('/sync/download-urls')) {
    let p: any = {};
    try {
      p = JSON.parse(event.body ?? '{}');
    } catch {
      return bad(400, 'body must be JSON');
    }
    const taskId = String(p.computerId ?? '');
    const token = syncToken(p, event);
    if (!taskId || !token) return bad(400, 'needs { computerId, token }');
    if (token !== `crewtopia-${taskId.slice(0, 8)}`) return bad(403, 'bad usage token');
    const out = await ddb.send(new GetCommand({ TableName: TABLE, Key: { taskId } }));
    if (!out.Item) {
      // Per-wallet sandbox (option B): computerId is wallet-stable, no task row.
      const { findSandboxByComputerId } = await import('./sandboxStore');
      const sb = await findSandboxByComputerId(taskId).catch(() => null);
      if (!sb) return bad(404, 'unknown computer');
    }
    try {
      const prefix = `backups/${taskId}/`;
      const listed = await s3.send(
        new ListObjectsV2Command({ Bucket: deliveryBucket(), Prefix: prefix, MaxKeys: 20000 }),
      );
      const files: Array<{ path: string; size: number; url: string }> = [];
      for (const o of listed.Contents ?? []) {
        if (!o.Key || !o.Key.startsWith(prefix)) continue;
        const path = o.Key.slice(prefix.length);
        if (cleanSyncPath(path) !== path) continue;
        files.push({
          path,
          size: o.Size ?? 0,
          url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: deliveryBucket(), Key: o.Key }), {
            expiresIn: 900,
          }),
        });
      }
      return ok({ files });
    } catch (e) {
      return bad(500, e instanceof Error ? e.message : 'list failed');
    }
  }

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
      body: JSON.stringify({ ownerId, computerId: taskId, secrets: { ...(modalKey ? { MODAL_API_KEY: modalKey } : {}), PROVIDER_API_KEY: providerKey }, usageToken: `crewtopia-${taskId.slice(0, 8)}`, apiUrl: process.env.COMPUTER_API_URL ?? 'https://example.com', workspace: { bucket: deliveryBucket(), prefix: 'backups/' } }),
    });
    console.log(`[sandbox] hook keys: PROVIDER=${providerKey.length} chars${modalKey ? ` MODAL=${modalKey.length} chars` : ''} -> ${hook.status} ${hook.text.slice(0, 200)}`);
    if (hook.status !== 200 || hook.json?.initialized !== true) {
      throw new Error(`hooks/run failed: ${hook.status} ${hook.text.slice(0, 200)}`);
    }

    // Pre-grant tool permissions for headless builds. The guest defaults to
    // ask-for-approval (human interactive); a hired team has no human in the
    // loop, so we seed broad allows. Includes skill/task/read-family: without
    // them the first skill load parks the run forever with nobody to approve.
    // Scoped to disposable build VMs only — narrow these patterns when briefs
    // get adversarial (v2 hardening). PUT replaces the rule list; unknown
    // permissions still fall back to ask.
    const perms = await vmFetch(endpoint, token, '/permissions', {
      method: 'PUT',
      body: JSON.stringify({ rules: [
        { permission: 'shell', pattern: '*', action: 'allow' },
        { permission: 'write', pattern: '*', action: 'allow' },
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'read', pattern: '*', action: 'allow' },
        { permission: 'read_file', pattern: '*', action: 'allow' },
        { permission: 'list', pattern: '*', action: 'allow' },
        { permission: 'glob', pattern: '*', action: 'allow' },
        { permission: 'grep', pattern: '*', action: 'allow' },
        { permission: 'skill', pattern: '*', action: 'allow' },
        { permission: 'task', pattern: '*', action: 'allow' },
        { permission: 'webfetch', pattern: '*', action: 'allow' },
        { permission: 'websearch', pattern: '*', action: 'allow' },
        { permission: 'grounded_search', pattern: '*', action: 'allow' },
        { permission: 'deliver', pattern: '*', action: 'allow' },
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
