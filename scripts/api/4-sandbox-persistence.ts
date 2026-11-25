/**
 * api/4-sandbox-persistence — backup depth test for per-wallet sandboxes.
 *
 * Writes N files (incl. a mini node app with installed deps), records sha256,
 * flushes, terminates, boots a NEW vm, pulls, re-hashes, byte-compares, and
 * proves the restored app runs. Re-runnable against any live sandbox; the
 * lifecycle script covers the loop, this one covers depth. Park =
 * flush + terminate + boot (platform suspend kills VMs — not used).
 *
 * Run: npx tsx api/4-sandbox-persistence.ts   (or: npm run api:sandbox-persistence)
 * Needs: scripts/.api-session.json (run 1-auth first). VM access mints
 *   through the app (POST /rent/sandbox/token) — no AWS creds needed.
 */
import { api, check, finish, requireSession } from "./config.js";

const POLL_MS = 10_000;
const BOOT_TIMEOUT_MS = 10 * 60_000;
const N_FILES = 30;

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

async function vmAccess(token: string): Promise<{ endpoint: string; vmTok: string }> {
  const t: any = await api("/rent/sandbox/token", token, { method: "POST", body: "{}" });
  if (!t.endpoint || !t.authToken) throw new Error("sandbox token mint failed");
  return { endpoint: t.endpoint, vmTok: t.authToken };
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

async function runToDone(endpoint: string, token: string, text: string, owner: string, timeoutMs = 600_000): Promise<string> {
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
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error("run did not finish in time");
    await sleep(3000);
    const ev = await vmFetch(endpoint, token, `/runs/${runId}/events?cursor=${cursor}`).catch(() => null);
    if (!ev) continue;
    for (const e of ev.json?.events ?? []) {
      if (typeof e.chunk === "string") out += e.chunk;
      if (typeof e.output === "string") out += e.output;
      if (e.type === "error") throw new Error(`sandbox run failed: ${(e.error ?? "").slice(0, 300)}`);
    }
    cursor = ev.json?.nextCursor ?? cursor + (ev.json?.events ?? []).length;
    if (ev.json?.done) return out;
  }
}

async function main() {
  const { token, address } = requireSession();
  const owner = address.toLowerCase();
  const tag = `persist-${Date.now() % 1000000}`;
  const timings: Record<string, number> = {};
  console.log(`[4-sandbox-persistence] owner=${owner} tag=${tag} files=${N_FILES}\n`);

  // 1. Boot (always — boot verifies liveness via GetMicrovm and
  // reprovisions when the record is stale; status alone can't be trusted).
  let t0 = Date.now();
  await api("/rent/sandbox/boot", token, { method: "POST", body: "{}" });
  let s: any = await waitState(token, "live", BOOT_TIMEOUT_MS);
  timings.boot_ms = Date.now() - t0;
  check("sandbox live", s.state === "live" && !!s.vmId, s.state);

  // 2. Seed: 30 files + mini app, all via ONE shell command (no heredocs —
  // the agent must pass it to the shell verbatim, never save-to-file first).
  const { endpoint, vmTok } = await vmAccess(token);
  const seedCmd =
    `mkdir -p /srv/computer/workspace/persist/${tag}/app` +
    ` && for i in $(seq -w 1 ${N_FILES}); do echo "line $i of ${tag}" > /srv/computer/workspace/persist/${tag}/file-$i.txt; done` +
    ` && printf '%s' '{"name":"persist-app","version":"1.0.0","dependencies":{"is-odd":"3.0.1"}}' > /srv/computer/workspace/persist/${tag}/app/package.json` +
    ` && printf '%s' 'const isOdd = require("is-odd"); console.log("APP_OK ${tag} isodd=" + isOdd(3));' > /srv/computer/workspace/persist/${tag}/app/index.js` +
    ` && cd /srv/computer/workspace/persist/${tag}/app && npm install --no-audit --no-fund --loglevel=error` +
    ` && echo "SEEDED $(ls /srv/computer/workspace/persist/${tag}/file-*.txt | wc -l) files"`;
  const seed = await runToDone(
    endpoint, vmTok,
    `Call the shell tool ONCE with exactly this command, character for character — do not wrap it, do not save it to a file, do not explain: ${seedCmd}. ` +
      `Reply with ONLY the last line of shell output. No other text.`,
    owner,
  );
  check("seeded files", /SEEDED/i.test(seed), seed.slice(0, 120));

  const hashCmd = (root: string) =>
    `find ${root} -type f -not -path '*/node_modules/*' | sort | xargs sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1`;
  const before = await runToDone(
    endpoint, vmTok,
    `Run in shell and reply with ONLY the hash: ${hashCmd(`/srv/computer/workspace/persist/${tag}`)}. No other text.`,
    owner,
  );
  const hashBefore = (before.match(/[0-9a-f]{64}/) ?? [])[0] ?? "";
  check("baseline hash captured", !!hashBefore, before.slice(0, 120));

  // 3. Flush → terminate → boot NEW vm (pull restores). Platform suspend
  // kills VMs, so park = flush + terminate + boot (no suspend/resume).
  t0 = Date.now();
  const flush: any = await api("/rent/sandbox/suspend", token, { method: "POST", body: "{}" });
  check("backup flushed", flush.ok === true && flush.flushed?.ok === true, JSON.stringify(flush).slice(0, 160));
  timings.flush_ms = Date.now() - t0;

  t0 = Date.now();
  await api("/rent/sandbox/terminate", token, { method: "POST", body: "{}" });
  await waitState(token, "terminated", 120_000);
  timings.terminate_ms = Date.now() - t0;

  t0 = Date.now();
  await api("/rent/sandbox/boot", token, { method: "POST", body: "{}" });
  s = await waitState(token, "live", BOOT_TIMEOUT_MS);
  timings.reboot_ms = Date.now() - t0;
  check("new VM after terminate", !!s.vmId, s.state);

  // 4. Re-hash on the new VM + prove the app runs (deps restored).
  const { endpoint: endpoint2, vmTok: vmTok2 } = await vmAccess(token);
  const after = await runToDone(
    endpoint2, vmTok2,
    `Run in shell and reply with ONLY the hash: ${hashCmd(`/srv/computer/workspace/persist/${tag}`)}. No other text.`,
    owner,
  );
  const hashAfter = (after.match(/[0-9a-f]{64}/) ?? [])[0] ?? "";
  check("hashes match after restore", !!hashAfter && hashAfter === hashBefore, `${hashBefore.slice(0, 12)} vs ${hashAfter.slice(0, 12)}`);

  const runApp = await runToDone(
    endpoint2, vmTok2,
    `In a shell, run these three commands in order, each waiting for the previous to finish: ` +
      `first: cd /srv/computer/workspace/persist/${tag}/app. ` +
      `second: npm install --no-audit --no-fund. ` +
      `third: node index.js. ` +
      `Reply with ONLY the single line printed by the third command. No other text.`,
    owner,
  );
  check("restored app reinstalls deps and runs", runApp.includes(`APP_OK ${tag}`), runApp.slice(0, 120));

  console.log("\n  timings (ms):");
  for (const [k, v] of Object.entries(timings)) console.log(`    ${k.padEnd(14)} ${v}`);
  finish("4-sandbox-persistence");
}

main().catch((e) => {
  console.error("4-sandbox-persistence crashed:", e?.message ?? e);
  process.exit(1);
});
