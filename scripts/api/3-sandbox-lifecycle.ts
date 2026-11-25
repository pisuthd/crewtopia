/**
 * api/3-sandbox-lifecycle — full per-wallet sandbox loop (option B), no rental.
 *
 * Boot → write probe files (operator VM access) → flush backup → verify via
 * preview proxy → terminate → boot NEW vm → verify files restored from
 * backup. Prints a timing table. Proves backup survives VM replacement.
 * Platform suspend kills VMs instead of parking them, so park =
 * flush + terminate + boot (no suspend/resume).
 *
 * Run: npx tsx api/3-sandbox-lifecycle.ts   (or: npm run api:sandbox-lifecycle)
 * Needs: scripts/.api-session.json (run 1-auth first) + AWS creds in the
 *   shell (same identity as `cdk deploy`) for the operator VM access.
 */
import {
  CreateMicrovmAuthTokenCommand,
  GetMicrovmCommand,
  LambdaMicrovmsClient,
} from "@aws-sdk/client-lambda-microvms";
import { api, check, finish, requireSession } from "./config.js";

const BASE = (
  process.env.API_BASE_URL ??
  process.env.A2A_BASE_URL ??
  "http://localhost:3000"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "ap-southeast-1";
const BOOT_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 10_000;

const mv = new LambdaMicrovmsClient({ region: REGION });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function status(token: string): Promise<any> {
  return api("/rent/sandbox/status", token);
}

async function waitState(token: string, want: string, timeoutMs: number): Promise<any> {
  const t0 = Date.now();
  for (;;) {
    const s: any = await status(token);
    if (s.state === want) return s;
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`timed out waiting for sandbox state=${want} (stuck at ${s.state})`);
    }
    await sleep(POLL_MS);
  }
}

async function vmEndpoint(vmId: string): Promise<string> {
  const got: any = await mv.send(new GetMicrovmCommand({ microvmIdentifier: vmId }));
  const endpoint = got.endpoint ?? "";
  if (!endpoint) throw new Error("VM has no endpoint yet");
  return endpoint;
}

async function mintVmToken(vmId: string): Promise<string> {
  const tok: any = await mv.send(
    new CreateMicrovmAuthTokenCommand({ microvmIdentifier: vmId, allowedPorts: [{ port: 8080 }], expirationInMinutes: 15 }),
  );
  const token = tok?.authToken?.["X-aws-proxy-auth"] ?? "";
  if (!token) throw new Error("VM token mint failed (operator AWS creds?)");
  return token;
}

async function vmFetch(endpoint: string, token: string, path: string, init?: RequestInit): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`https://${endpoint}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), "X-aws-proxy-auth": token, "content-type": "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch { /* plain text */ }
  return { status: res.status, json, text };
}

/** POST /task on the VM and wait for the run to finish; returns full output. */
async function runToDone(endpoint: string, token: string, text: string, owner: string): Promise<string> {
  const start = await vmFetch(endpoint, token, "/task", {
    method: "POST",
    body: JSON.stringify({ text, ownerId: owner }),
  });
  if (start.status !== 202 && start.status !== 200) {
    throw new Error(`sandbox /task rejected (${start.status}): ${start.text.slice(0, 200)}`);
  }
  const runId = start.json?.runId ?? start.json?.run_id ?? start.json?.id;
  if (!runId) throw new Error("sandbox returned no run id");
  let cursor = 0;
  let out = "";
  const seen = new Set<string>();
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`run did not finish in time (saw: ${[...seen].join(",") || "nothing"}; out: ${out.slice(0, 200)})`);
    }
    await sleep(3000);
    const ev = await vmFetch(endpoint, token, `/runs/${runId}/events?cursor=${cursor}`).catch(() => null);
    if (!ev) continue;
    for (const e of ev.json?.events ?? []) {
      if (e.type) seen.add(String(e.type));
      if (typeof e.chunk === "string") out += e.chunk;
      if (typeof e.output === "string") out += e.output;
      if (e.type === "approval" || e.type === "question") {
        out += `\n[${e.type}: ${JSON.stringify(e).slice(0, 300)}]`;
      }
      if (e.type === "error") throw new Error(`sandbox run failed: ${(e.error ?? "").slice(0, 300)}`);
    }
    cursor = ev.json?.nextCursor ?? cursor + (ev.json?.events ?? []).length;
    if (ev.json?.done) return out;
  }
}

/** Fetch a workspace file through the signed preview proxy (browser path). */
async function previewFile(token: string, target: string): Promise<string> {
  const t: any = await api("/rent/preview/token", token, {
    method: "POST",
    body: JSON.stringify({ scope: "preview", target }),
  });
  if (!t.path) throw new Error("preview token mint failed");
  const res = await fetch(`${BASE}${t.path}`);
  if (!res.ok) throw new Error(`preview fetch failed (${res.status})`);
  return res.text();
}

async function main() {
  const { token, address } = requireSession();
  const owner = address.toLowerCase();
  const marker = `probe-${Date.now() % 1000000}`;
  const file = `probe/${marker}.txt`;
  const timings: Record<string, number> = {};
  console.log(`[6-sandbox-lifecycle] owner=${owner} marker=${marker}\n`);

  // 1. Boot (always — boot verifies liveness via GetMicrovm and
  // reprovisions when the record is stale; status alone can't be trusted).
  let t0 = Date.now();
  const b0: any = await api("/rent/sandbox/boot", token, { method: "POST", body: "{}" });
  check("boot accepted", b0.accepted === true || b0.state === "live", JSON.stringify(b0).slice(0, 120));
  let s: any = await waitState(token, "live", BOOT_TIMEOUT_MS);
  timings.boot_ms = Date.now() - t0;
  check("sandbox live", s.state === "live" && !!s.vmId, s.state);
  const vmId1 = s.vmId as string;

  // 2. Operator write: probe file straight into the workspace.
  const endpoint1 = await vmEndpoint(vmId1);
  const vmTok1 = await mintVmToken(vmId1);
  await runToDone(
    endpoint1, vmTok1,
    `Write the file /srv/computer/workspace/probe/${marker}.txt with exactly this content (no trailing newline matters): ${marker}. ` +
      `Use the shell or write tool. Reply with ONLY the word DONE. No other text.`,
    owner,
  );
  // Independent read-back in a SECOND run — never trust the writer's echo.
  const readBack = await runToDone(
    endpoint1, vmTok1,
    `Run in shell and reply with ONLY the file content: cat /srv/computer/workspace/probe/${marker}.txt. No other text.`,
    owner,
  );
  check("probe file written + read back", readBack.includes(marker), readBack.slice(0, 120));

  // 3. Flush backup (route triggers the VM-side push; VM stays live).
  // Platform suspend kills VMs instead of parking them, so park =
  // flush + terminate + boot. Suspend/resume is not used.
  t0 = Date.now();
  const flush: any = await api("/rent/sandbox/suspend", token, { method: "POST", body: "{}" });
  check("backup flushed", flush.ok === true && flush.flushed?.ok === true, JSON.stringify(flush).slice(0, 160));
  timings.flush_ms = Date.now() - t0;
  console.log(`  flushed: ${JSON.stringify(flush.flushed ?? {}).slice(0, 160)}`);

  // 4. Verify via the browser path (signed preview proxy, no operator creds).
  const viaPreview = await previewFile(token, file);
  check("probe file served via preview", viaPreview.includes(marker), viaPreview.slice(0, 120));

  // 5. Terminate → boot NEW vm → verify the backup restored the file.
  t0 = Date.now();
  const term: any = await api("/rent/sandbox/terminate", token, { method: "POST", body: "{}" });
  check("terminate accepted", term.ok === true, JSON.stringify(term).slice(0, 120));
  await waitState(token, "terminated", 120_000);
  timings.terminate_ms = Date.now() - t0;

  t0 = Date.now();
  const b2: any = await api("/rent/sandbox/boot", token, { method: "POST", body: "{}" });
  check("re-boot accepted", b2.accepted === true || b2.state === "live", JSON.stringify(b2).slice(0, 120));
  s = await waitState(token, "live", BOOT_TIMEOUT_MS);
  timings.reboot_ms = Date.now() - t0;
  check("new VM after terminate", !!s.vmId && s.vmId !== vmId1, `${s.vmId} vs ${vmId1}`);

  const restored = await previewFile(token, file);
  check("probe file restored on new VM", restored.includes(marker), restored.slice(0, 120));

  console.log("\n  timings (ms):");
  for (const [k, v] of Object.entries(timings)) console.log(`    ${k.padEnd(14)} ${v}`);
  finish("6-sandbox-lifecycle");
}

main().catch((e) => {
  console.error("6-sandbox-lifecycle crashed:", e?.message ?? e);
  process.exit(1);
});



// PS C:\projects\crewtopia\scripts> npm run api:sandbox-lifecycle

// > crewtopia-scripts@0.1.0 api:sandbox-lifecycle
// > tsx api/3-sandbox-lifecycle.ts

// [6-sandbox-lifecycle] owner=0x971f6680a20671458d456656081ea8e32102a64e marker=probe-626121

//   ok — boot accepted
//   ok — sandbox live
//   ok — probe file written + read back
//   ok — backup flushed
//   flushed: {"ok":true,"pushed":98,"bytes":410222}
//   ok — probe file served via preview
//   ok — terminate accepted
//   ok — re-boot accepted
//   ok — new VM after terminate
//   ok — probe file restored on new VM

//   timings (ms):
//     boot_ms        31260
//     flush_ms       1219
//     terminate_ms   272
//     reboot_ms      30776

// 6-sandbox-lifecycle GREEN
// PS C:\projects\crewtopia\scripts>
