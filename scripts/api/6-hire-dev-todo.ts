/**
 * api/6-hire-dev-todo — hire the Dev Crew for a quick static build (option B:
 * crew runs in the renter's wallet sandbox). Funds 30 min, briefs a
 * single-file HTML landing page, waits for the preview, gets the download
 * link, asserts the zip. Leaves the rental running (settle separately).
 *
 * Run: npx tsx api/6-hire-dev-todo.ts   (or: npm run api:hire-dev-todo)
 * Needs: scripts/.api-session.json (run 1-auth first) + PRIVATE_KEY with
 *   test U + tBNB gas. Spends ~0.005 U (30 min @ 0.01 U/hr).
 */
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { api, check, finish, requireSession } from "./config.js";
import { loadEnv } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

loadEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));

const BASE = (
  process.env.API_BASE_URL ??
  process.env.A2A_BASE_URL ??
  "http://localhost:3000"
).replace(/\/+$/, "");
const MINUTES = 30; // static landing: kickoff + write + serve + deliver, no build step
const SEND_URL = `${BASE}/a2a/message/send`;

async function send(data: Record<string, unknown>): Promise<any> {
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "message/send",
      params: { message: { messageId: crypto.randomUUID(), role: "user", parts: [{ kind: "data", data }] } },
    }),
  });
  return res.json();
}

function taskText(reply: any): string {
  return reply?.result?.status?.message?.parts?.[0]?.text ?? "";
}

async function crewChat(token: string, taskId: string, role: string, message: string, timeoutMs = 600_000): Promise<{ text: string; runId: string; done: boolean; note: string }> {
  // Start may hit a booting sandbox (202 retryable) — wait for live, retry.
  let s: any = null;
  const startDeadline = Date.now() + 600_000;
  while (Date.now() < startDeadline) {
    s = await api("/rent/crew/chat", token, {
      method: "POST",
      body: JSON.stringify({ taskId, role, message }),
    });
    if (s?.error && !s?.retryable) throw new Error(`crew-chat start ${role}: ${s.error}`);
    if (s?.runId) break;
    await api("/rent/sandbox/boot", token, { method: "POST", body: "{}" }).catch(() => null);
    for (let i = 0; i < 30; i++) {
      const st: any = await api("/rent/sandbox/status", token).catch(() => null);
      if (st?.state === "live") break;
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  if (!s?.runId) throw new Error(`crew-chat start ${role}: sandbox never came live`);
  let cursor = 0;
  let out = "";
  let note = "";
  let done = false;
  const deadline = Date.now() + timeoutMs;
  // Scripted buyer: auto-approve the gates this demo needs (serve 5173,
  // deliver the zip). Anything else stays parked for a human.
  let vmEp = "";
  let vmTok = "";
  const approveIfSafe = async (a: any): Promise<boolean> => {
    const perm = String(a?.permission ?? "");
    const target = String(a?.target ?? "");
    const okServe = perm === "shell" && /http\.server|serve\b.*5173|5173.*serve|nohup/i.test(target);
    const okDeliver = perm === "deliver";
    if (!okServe && !okDeliver) return false;
    if (!vmEp) {
      const t: any = await api("/rent/sandbox/token", token, { method: "POST", body: "{}" });
      if (!t?.endpoint || !t?.authToken) return false;
      vmEp = t.endpoint;
      vmTok = t.authToken;
    }
    const r = await fetch(`https://${vmEp}/approvals/${a.approvalId}`, {
      method: "POST",
      headers: { "X-aws-proxy-auth": vmTok, "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    return !!r && r.ok;
  };
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const p: any = await api(
      `/rent/crew/chat?taskId=${encodeURIComponent(taskId)}&role=${encodeURIComponent(role)}&runId=${encodeURIComponent(s.runId)}&cursor=${cursor}`,
      token,
    );
    if (p?.error) throw new Error(`crew-chat poll ${role}: ${p.error}`);
    out += String(p?.text ?? "");
    if (p?.note && !note) note = String(p.note);
    if (p?.approval?.approvalId) {
      const ok = await approveIfSafe(p.approval);
      console.log(`  approval ${p.approval.permission} "${String(p.approval.target).slice(0, 80)}" → ${ok ? "approved" : "left parked"}`);
    }
    cursor = Number(p?.nextCursor ?? cursor);
    if (p?.done) {
      done = true;
      break;
    }
  }
  if (!done) console.log(`  note — ${role} run still going after ${Math.round(timeoutMs / 60000)}m (partial: ${out.slice(0, 120)}${note ? ` | note: ${note.slice(0, 120)}` : ""})`);
  return { text: out, runId: s.runId as string, done, note };
}

async function waitRunDone(token: string, taskId: string, role: string, runId: string, label: string, timeoutMs = 600_000): Promise<void> {
  const t0 = Date.now();
  let cursor = 0;
  while (Date.now() - t0 < timeoutMs) {
    const p: any = await api(
      `/rent/crew/chat?taskId=${encodeURIComponent(taskId)}&role=${encodeURIComponent(role)}&runId=${encodeURIComponent(runId)}&cursor=${cursor}`,
      token,
    ).catch((e: Error) => ({ error: e.message }));
    if (p?.error) throw new Error(`${label}: ${p.error}`);
    if (typeof p?.nextCursor === "number") cursor = p.nextCursor;
    if (p?.done) {
      console.log(`  ${label}: run finished.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error(`${label}: still running after ${Math.round(timeoutMs / 60000)}m`);
}

async function main() {
  const { token, address } = requireSession();
  console.log(`[6-hire-dev-todo] owner=${address.toLowerCase()}\n`);

  // 1-3. Resume a live rental if we have one, else negotiate → accept → fund.
  const rawKey = process.env.PRIVATE_KEY;
  if (!rawKey) throw new Error("PRIVATE_KEY required in scripts/.env");
  const account = privateKeyToAccount(rawKey as `0x${string}`);
  const signer = createWalletClient({ account, chain: bscTestnet, transport: http() });
  const bind = async (tag: string) => {
    const nonce = `${tag}-${Date.now()}`;
    const sig = await signer.signMessage({ message: `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${nonce}` });
    return { nonce, sig };
  };
  const brief = "Build a single-file static landing page (index.html + Tailwind via CDN, no build step, no npm) for a fictional BNB Chain hackathon: hero, schedule, sponsors, FAQ. Serve it and deliver it.";
  const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), ".last-hire-todo.json");
  const loadState = (): { taskId?: string; jobId?: string } => {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf8"));
    } catch {
      return {};
    }
  };
  const saveState = (s: object) => writeFileSync(STATE_FILE, JSON.stringify(s) + "\n");
  let taskId: string | undefined;
  let jobId: string | undefined;
  const saved = loadState();
  if (saved.taskId) {
    const rs: any = await send({ skill: "web3-task-status", task_id: saved.taskId }).catch(() => null);
    const rsText = taskText(rs);
    const leftMatch = /~(\d+) min left/.exec(rsText);
    if (rsText.includes("status=working") && leftMatch && Number(leftMatch[1]) > 5) {
      taskId = saved.taskId;
      jobId = saved.jobId;
      console.log(`  resuming live rental ${taskId} (~${leftMatch[1]} min left)`);
    } else {
      console.log(`  saved rental not usable (${rsText.slice(0, 100) || "unknown"}) — hiring fresh`);
    }
  }
  if (!taskId) {
    const b0 = await bind("team6");
    const r1 = await send({ skill: "negotiate-web3-task", teamId: "dev-crew", brief, minutes: MINUTES, buyerAddress: account.address, nonce: b0.nonce, buyerSig: b0.sig });
    taskId = /task_id ([0-9a-f-]{36})/.exec(taskText(r1))?.[1] ?? "";
    check("dev quote returns task_id", !!taskId, taskId ?? "");
    const quote = (r1?.result?.artifacts ?? []).find((a: any) => a?.name === "quote")?.parts?.[0]?.data;
    const b1 = await bind("accept6");
    let r2: any = null;
    for (let attempt = 0; attempt < 3 && !r2?.result && !r2?.error; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 15000));
      const ba = await bind(`accept6r${attempt}`);
      r2 = await send({ skill: "accept-web3-quote", task_id: taskId, buyerAddress: account.address, nonce: ba.nonce, buyerSig: ba.sig });
    }
    jobId = (r2?.result?.artifacts ?? []).find((a: any) => a?.name === "escrow")?.parts?.[0]?.data?.jobId;
    check("accept returns jobId", !!jobId, jobId ?? r2?.error?.message ?? "gateway envelope");
    if (!jobId) throw new Error(`accept failed: ${r2?.error?.message ?? "gateway envelope, see run output"}`);
    const { ERC8183Client, EVMWalletProvider } = await import("@bnbagent/sdk");
    const buyerClient = await ERC8183Client.create({ walletProvider: new EVMWalletProvider({ password: process.env.WALLET_PASSWORD!, privateKey: rawKey }), network: "bsc-testnet" });
    await buyerClient.fund(BigInt(jobId), BigInt(quote.totalWei));
    let t3 = "";
    for (let i = 0; i < 20; i++) {
      const r3 = await send({ skill: "web3-task-status", task_id: taskId });
      t3 = taskText(r3);
      if (t3.includes("status=working")) break;
      await new Promise((r) => setTimeout(r, 30000));
    }
    check("funded task flips to WORKING", t3.includes("status=working"), t3.slice(0, 140));
    saveState({ taskId, jobId });
  } else {
    check("resumed working rental", true, taskId);
  }
  const TASK_ID: string = taskId as string;

  // 4. Snapshot the placeholder (boot serves the workspace root on 5173, also
  // HTTP 200) so the preview check below can't pass on it. Then brief Taylor
  // with DONE criteria — no conversational replies, only DONE when verified.
  async function previewRoot(): Promise<{ status: number; body: string } | null> {
    const t: any = await api("/rent/preview/token", token, {
      method: "POST",
      body: JSON.stringify({ scope: "dev", port: 5173 }),
    }).catch(() => null);
    if (!t?.path) return null;
    const res = await fetch(`${BASE}${t.path}`).catch(() => null);
    if (!res) return null;
    return { status: res.status, body: await res.text().catch(() => "") };
  }
  const placeholder = await previewRoot();
  console.log(`  placeholder snapshot: status=${placeholder?.status ?? "none"} bytes=${placeholder?.body.length ?? 0}`);

  // 5. Kickoff Taylor (fire — the run keeps working in the background).
  // We do NOT wait for it here: the preview loop below is the progress signal,
  // and waitRunDone serializes before deliver so runs never overlap.
  const ko = await crewChat(token, TASK_ID, "pm", `${brief} Split the work across the roster with @mentions and drive it to done — Reef owns writing the page AND serving it on port 5173, Moss owns review. You coordinate only: never run shell commands yourself, never serve the port yourself. When all members report done, have Reef run the deliver tool with task_id "${TASK_ID}" and share the download link. Verify each step yourself (ask Reef to curl localhost:5173, confirm deliver output) — never report done on assumption. Do not reply conversationally — only DONE plus a one-line summary when everything above is true.`, 180_000);
  console.log(`  kickoff run=${ko.runId} done=${ko.done} note=${(ko.note || "none").slice(0, 120)}`);
  check("Taylor kicked off", /done|reef|moss|plan|split|build/i.test(ko.text), ko.text.slice(0, 160));

  // 6. Supervisor loop: real preview = 200 + different from placeholder +
  // an actual app root element. Logs progress every round so a slow build
  // doesn't look stuck. Status asks are rare and informational only.
  const t0 = Date.now();
  const mins = () => Math.round((Date.now() - t0) / 60000);
  let previewOk = false;
  let rounds = 0;
  for (let i = 0; i < 40 && !previewOk; i++) {
    const cur = await previewRoot();
    const isApp = !!cur && cur.status === 200 && cur.body !== (placeholder?.body ?? null) && /cdn\.tailwindcss\.com|tailwind/i.test(cur.body);
    if (isApp) {
      previewOk = true;
      break;
    }
    rounds += 1;
    console.log(`  [${mins()}m] waiting for page on 5173 (placeholder still serving, page in progress…)`);
    await new Promise((r) => setTimeout(r, 30000));
    if (rounds % 10 === 0) {
      const st = await crewChat(token, TASK_ID, "pm", "One-line status only: what is built, what remains, ETA minutes. If blocked, reply BLOCKED plus the one-line reason.", 120_000).catch((e: Error) => ({ text: e.message, runId: "", done: true, note: "" }));
      console.log(`  status check: ${st.text.slice(0, 200)}`);
      if (/BLOCKED/i.test(st.text)) throw new Error(`crew blocked: ${st.text.slice(0, 200)}`);
    }
  }
  check("dev server serves the built app (not placeholder)", previewOk);

  // 7. Serialize: wait for the kickoff run to finish before starting deliver,
  // so two runs never talk over each other in one thread.
  if (previewOk && !ko.done) {
    await waitRunDone(token, TASK_ID, "pm", ko.runId, "kickoff run", 600_000).catch((e: Error) => {
      console.log(`  note — kickoff still going: ${e.message.slice(0, 120)}`);
    });
  }

  // 8. Ask Reef to run deliver + share the link, then fetch + verify the zip.
  // Fallback: Taylor's DONE posts already carry presigned links — scan the
  // pm thread for the latest one (deliveries persist per task).
  const dl = await crewChat(token, TASK_ID, "frontend", `Run the deliver tool with task_id "${TASK_ID}", then share the download link. Reply with ONLY the link.`, 600_000);
  let url = (dl.text.match(/https?:\/\/[^\s)"']+/) ?? [])[0] ?? "";
  if (!url) {
    const pm: any = await api(`/rent/messages?taskId=${encodeURIComponent(TASK_ID)}&role=pm`, token).catch(() => null);
    const links = ((pm?.messages ?? []) as any[])
      .map((m) => String(m?.text ?? "").match(/https?:\/\/[^\s)"']+/))
      .filter(Boolean)
      .map((m: RegExpMatchArray) => m[0]);
    url = links[links.length - 1] ?? "";
    if (url) console.log(`  link recovered from pm thread (${links.length} found)`);
  }
  check("crew shared a download link", !!url, dl.text.slice(0, 160) || dl.note);
  if (url) {
    const z = await fetch(url).catch(() => null);
    const buf = z ? Buffer.from(await z.arrayBuffer().catch(() => [])) : Buffer.alloc(0);
    const isZip = buf.length > 2 && buf[0] === 0x50 && buf[1] === 0x4b;
    check("download is a zip", !!z && z.ok && isZip, `status=${z?.status} bytes=${buf.length}`);
  }

  console.log(`\n  rental left running — TERMINATE it when done, or let the window expire. task=${TASK_ID}`);
  if (url) console.log(`\n  DOWNLOAD:\n  ${url}\n`);
  finish("6-hire-dev-todo");
}

main().catch((e) => {
  console.error("6-hire-dev-todo crashed:", e?.message ?? e);
  process.exit(1);
});
