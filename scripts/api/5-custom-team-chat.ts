/**
 * api/5-custom-team-chat — hire a custom team and chat with it (option B: crew
 * runs in the renter's wallet sandbox). Creates the team if missing, funds a
 * short rental, asks a factual question, asserts the routed answer.
 *
 * Run: npx tsx api/5-custom-team-chat.ts   (or: npm run api:custom-team-chat)
 * Needs: scripts/.api-session.json (run 1-auth first) + PRIVATE_KEY with test
 *   U + tBNB gas. Spends ~0.002 U (12 min @ 0.01 U/hr).
 */
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { api, check, finish, requireSession } from "./config.js";
import { loadEnv, ERC8183Client, EVMWalletProvider } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorAndFund } from "../a2a/anchor.js";

loadEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));

const BASE = (
  process.env.API_BASE_URL ??
  process.env.A2A_BASE_URL ??
  "http://localhost:3000"
).replace(/\/+$/, "");
const SEND_URL = `${BASE}/a2a/message/send`;

const TEAM_NAME = "Atlas Solo";
const TEAM_ROLE = "oracle";

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

async function main() {
  const { token, address } = requireSession();
  const owner = address.toLowerCase();
  const teamId = `custom-${owner.slice(2, 8)}-atlas-solo`;
  console.log(`[7-custom-team-chat] owner=${owner} team=${teamId}\n`);

  // 1. Recreate the custom team fresh every run (deterministic id, so this
  // also exercises delete). The oracle brief forbids tool use — exact answers.
  const teamBrief = "You are Atlas, a factual oracle. Answer ONLY with the exact requested answer text and nothing else — no greeting, no explanation, no tools, never build anything. The caller checks your exact words.";
  await api(`/rent/teams?teamId=${encodeURIComponent(teamId)}`, token, { method: "DELETE" }).catch(() => null);
  const created: any = await api("/rent/teams", token, {
    method: "POST",
    body: JSON.stringify({
      name: "Atlas Solo",
      description: "One-bot oracle crew for quick factual questions.",
      members: [
        { role: TEAM_ROLE, name: "Atlas", title: "Oracle", brief: teamBrief },
      ],
    }),
  });
  check("custom team created", created?.teamId === teamId, created?.teamId ?? "no id");

  // 2. Negotiate bound, 12 minutes.
  const rawKey = process.env.PRIVATE_KEY;
  if (!rawKey) throw new Error("PRIVATE_KEY required in scripts/.env");
  const account = privateKeyToAccount(rawKey as `0x${string}`);
  const signer = createWalletClient({ account, chain: bscTestnet, transport: http() });
  const nonce = `team7-${Date.now()}`;
  const buyerSig = await signer.signMessage({ message: `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${nonce}` });
  const r1 = await send({ skill: "negotiate-web3-task", teamId, brief: "Answer one geography question.", minutes: 12, buyerAddress: account.address, nonce, buyerSig });
  const t1 = taskText(r1);
  const taskId = /task_id ([0-9a-f-]{36})/.exec(t1)?.[1] ?? "";
  check("quote mentions Atlas Solo", t1.includes("Atlas Solo"), t1.slice(0, 100));
  check("bound negotiate returns task_id", !!taskId, taskId);
  const quote = (r1?.result?.artifacts ?? []).find((a: any) => a?.name === "quote")?.parts?.[0]?.data;
  check("quote is 12 min / 0.002 U", quote?.fundedSeconds === 720 && quote?.totalU === "0.002", JSON.stringify(quote));

  // 3. Accept → buyer anchors + funds → poll to WORKING (crew auto-starts in sandbox).
  const bind = async (tag: string) => {
    const nonce = `${tag}-${Date.now()}`;
    const sig = await signer.signMessage({ message: `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${nonce}` });
    return { nonce, sig };
  };
  const buyerClient = await ERC8183Client.create({ walletProvider: new EVMWalletProvider({ password: process.env.WALLET_PASSWORD!, privateKey: rawKey }), network: "bsc-testnet" });
  const { jobId } = await anchorAndFund({ send, bind, buyerClient, buyerAddress: account.address, taskId, tag: "team7-acc" });
  check("job anchored + funded", !!jobId, String(jobId));
  let t3 = "";
  for (let i = 0; i < 20; i++) {
    const r3 = await send({ skill: "web3-task-status", task_id: taskId });
    t3 = taskText(r3);
    if (t3.includes("status=working")) break;
    await new Promise((r) => setTimeout(r, 30000));
  }
  check("funded task flips to WORKING", t3.includes("status=working"), t3.slice(0, 140));

  // 4. Chat with the hired member: start the run, then poll for chunks
  // (agentic runs outlive the ~29s gateway clock).
  const started: any = await api("/rent/crew/chat", token, {
    method: "POST",
    body: JSON.stringify({ taskId, role: TEAM_ROLE, message: "What is the capital of Thailand? Answer in one sentence." }),
  }).catch((e: Error) => ({ error: e.message }));
  let runId = started?.runId;
  if (!runId) {
    // Sandbox may be booting (gateway-safe 202) — wait for live, start once.
    for (let i = 0; i < 30; i++) {
      const st: any = await api("/rent/sandbox/status", token).catch(() => null);
      if (st?.state === "live") break;
      await new Promise((r) => setTimeout(r, 10000));
    }
    const retry: any = await api("/rent/crew/chat", token, {
      method: "POST",
      body: JSON.stringify({ taskId, role: TEAM_ROLE, message: "What is the capital of Thailand? Answer in one sentence." }),
    }).catch((e: Error) => ({ error: e.message }));
    if (retry?.error || !retry?.runId) throw new Error(`crew-chat start: ${retry?.error ?? "no run id"}`);
    runId = retry.runId;
  }
  let cursor = 0;
  let reply = "";
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const p: any = await api(
      `/rent/crew/chat?taskId=${taskId}&role=${TEAM_ROLE}&runId=${runId}&cursor=${cursor}`,
      token,
    );
    if (p?.error) throw new Error(`crew-chat poll: ${p.error}`);
    reply += String(p?.text ?? "");
    cursor = Number(p?.nextCursor ?? cursor);
    if (p?.done) break;
  }
  check("crew answered", reply.length > 0, reply.slice(0, 120));
  check("answer names Bangkok", /bangkok/i.test(reply), reply.slice(0, 120));

  // 5. Clock is ticking on the rental.
  const r4 = await send({ skill: "web3-task-status", task_id: taskId });
  check("clock shows time left", /min left/.test(taskText(r4)), taskText(r4).slice(0, 140));

  console.log(`\n  rental left running — TERMINATE it when done, or let the window expire. task=${taskId}`);
  finish("7-custom-team-chat");
}

main().catch((e) => {
  console.error("7-custom-team-chat crashed:", e?.message ?? e);
  process.exit(1);
});
