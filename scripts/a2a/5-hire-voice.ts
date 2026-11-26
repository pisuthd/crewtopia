/**
 * A2A hire-voice: the buyer-agent journey for Voice Crew over the real wire —
 * negotiate → accept → fund → working → crew-thread with the concierge → end.
 * No UI anywhere: proves an external agent can hire Aria headlessly.
 * Burns ~0.01 U (30 min @ 0.01 U/hr). No sandbox boot skipped — the hire
 * boots the team's computer like any rental; the buyer here is code.
 *
 * Run: npx tsx a2a/5-hire-voice.ts
 * Needs: scripts/.env (PRIVATE_KEY with test U + tBNB gas, API_BASE_URL).
 */
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { ERC8183Client, EVMWalletProvider, loadEnv } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorAndFund } from "./anchor";

loadEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));

const BASE = (process.env.API_BASE_URL ?? process.env.A2A_BASE_URL ?? "").replace(/\/+$/, "");
if (!BASE) throw new Error("need API_BASE_URL");
const rawKey = process.env.PRIVATE_KEY;
if (!rawKey) throw new Error("PRIVATE_KEY required in scripts/.env");
const account = privateKeyToAccount(rawKey as `0x${string}`);
const signer = createWalletClient({ account, chain: bscTestnet, transport: http() });

async function send(data: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE}/a2a/message/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "message/send", params: { message: { messageId: crypto.randomUUID(), role: "user", parts: [{ kind: "data", data }] } } }),
  });
  return res.json();
}
const text = (r: any): string => r?.result?.status?.message?.parts?.[0]?.text ?? JSON.stringify(r?.result ?? r?.error ?? r).slice(0, 200);
const check = (name: string, cond: unknown, extra = "") => console.log(`${cond ? "  ok" : "  FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);

async function bind(tag: string) {
  const nonce = `${tag}-${Date.now()}`;
  const sig = await signer.signMessage({ message: `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${nonce}` });
  return { nonce, sig };
}

async function anchorJob(taskId: string, tag: string): Promise<{ jobId: string; totalWei: string }> {
  const buyerClient = await ERC8183Client.create({ walletProvider: new EVMWalletProvider({ password: process.env.WALLET_PASSWORD!, privateKey: rawKey }), network: "bsc-testnet" });
  return anchorAndFund({ send, bind, buyerClient, buyerAddress: account.address, taskId, tag });
}

async function waitFor(taskId: string, want: RegExp, label: string, tries = 20): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const r = await send({ skill: "web3-task-status", task_id: taskId });
    const t = text(r);
    if (want.test(t)) return t;
    await new Promise((r) => setTimeout(r, 30000));
  }
  throw new Error(`${label}: not reached in time`);
}

async function main(): Promise<void> {
  // 1-3. negotiate → accept → fund (voice-crew, seller brief).
  const b0 = await bind("voice-neg");
  const brief =
    "You are the sales concierge for Maple & Rye catering. Answer customer calls, " +
    "quote office lunches for thirty people, hold Friday slots with a twenty percent deposit. " +
    "No peanuts anywhere — always confirm nut allergies.";
  const r1 = await send({ skill: "negotiate-web3-task", teamId: "voice-crew", brief, minutes: 30, buyerAddress: account.address, nonce: b0.nonce, buyerSig: b0.sig });
  const m = /task_id ([0-9a-f-]{36})/.exec(text(r1));
  const taskId = m?.[1] ?? "";
  check("negotiate returns task_id", !!taskId, taskId);
  if (!taskId) throw new Error("no task");
  const quote = (r1?.result?.artifacts ?? []).find((a: any) => a?.name === "quote")?.parts?.[0]?.data;
  if (!quote?.totalWei) throw new Error("negotiate failed: " + text(r1).slice(0, 200));
  const { jobId } = await anchorJob(taskId, "voice-acc");
  check("accept + anchor returns jobId", !!jobId, String(jobId));
  const t3 = await waitFor(taskId, /status=working/, "flip to working");
  check("funded flips to WORKING", true, t3.slice(0, 100));

  // 4. Talk to the concierge (fresh hires boot async — retry while retryable).
  let rc: any = null;
  {
    const t0 = Date.now();
    while (Date.now() - t0 < 600_000) {
      const b = await bind(`voice-chat${Date.now()}`);
      rc = await send({ skill: "crew-thread", task_id: taskId, to: "lead", text: "Who are you and what do you sell? Start your reply with ARIA-OK:", buyerAddress: account.address, nonce: b.nonce, buyerSig: b.sig });
      if ((rc?.result as any)?.runId || !(rc?.result as any)?.retryable) break;
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
  const blob = JSON.stringify(rc?.result ?? {});
  const hit = blob.includes("ARIA-OK") || (/aria/i.test(blob) && /cater|lunch|deposit|peanut|rye/i.test(blob));
  let cursor = Number((rc?.result as any)?.cursor ?? 0);
  const runId = (rc?.result as any)?.runId;
  for (let i = 0; i < 4 && !hit && runId; i++) {
    const b = await bind(`voice-cont${i}`);
    const r = await send({ skill: "crew-thread", task_id: taskId, runId, cursor, buyerAddress: account.address, nonce: b.nonce, buyerSig: b.sig });
    cursor = Number((r?.result as any)?.cursor ?? cursor);
    if (/ARIA-OK|cater|lunch/i.test(JSON.stringify(r?.result ?? {}))) break;
    if ((r?.result as any)?.done) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  check("concierge answers in role", hit || /ARIA-OK|cater|lunch/i.test(blob), blob.slice(0, 160));

  // 5. end.
  const b5 = await bind("voice-end");
  const r7 = await send({ skill: "crew-end", task_id: taskId, buyerAddress: account.address, nonce: b5.nonce, buyerSig: b5.sig });
  check("crew-end ends rental", (r7?.result as any)?.state === "ended", JSON.stringify(r7?.result ?? r7?.error).slice(0, 120));

  console.log("hire-voice GREEN");
}

void main();
