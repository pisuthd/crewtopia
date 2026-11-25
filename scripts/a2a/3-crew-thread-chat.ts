/**
 * Live crew-thread turn over the real A2A wire: signed chat with the hired
 * crew — address the lead, @mention a member, continue an unfinished turn.
 * Deltas only, mirrors what a buyer agent does (no app session involved).
 *
 * Run: TASK_ID=<uuid> npx tsx scripts/a2a/3-crew-thread-chat.ts
 * Needs: scripts/.env (PRIVATE_KEY of the task buyer) + a WORKING rental.
 */
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { loadEnv } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

loadEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));

const BASE = (process.env.API_BASE_URL ?? process.env.A2A_BASE_URL ?? "").replace(/\/+$/, "");
const taskId = process.env.TASK_ID ?? "";
if (!BASE || !taskId) throw new Error("need API_BASE_URL and TASK_ID");
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

async function main(): Promise<void> {
  const bind = async (tag: string) => {
    const nonce = `${tag}-${Date.now()}`;
    const sig = await signer.signMessage({ message: `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${nonce}` });
    return { nonce, sig };
  };
  // 1. Turn to the lead with an @mention — expect role-attributed replies.
  const b0 = await bind("thread1");
  const r1 = await send({ skill: "crew-thread", task_id: taskId, to: "lead", text: "One-line status only: what is built, what remains, ETA minutes. If blocked, reply BLOCKED plus the one-line reason.", buyerAddress: account.address, nonce: b0.nonce, buyerSig: b0.sig });
  const res1 = r1?.result ?? {};
  console.log("turn1 done:", !!res1.done, "replies:", (res1.replies ?? []).map((m: any) => `${m.name}: ${(m.text ?? "").slice(0, 100)}`).join(" | ").slice(0, 300));
  if (!res1.runId) throw new Error(`no run started: ${text(r1).slice(0, 200)}`);

  // 2. Continue an unfinished turn via runId + cursor (no-op when done:true).
  let cursor = Number(res1.cursor ?? 0);
  let done = !!res1.done;
  for (let i = 0; i < 6 && !done; i++) {
    const b = await bind(`thread-c${i}`);
    const r = await send({ skill: "crew-thread", task_id: taskId, runId: res1.runId, cursor, buyerAddress: account.address, nonce: b.nonce, buyerSig: b.sig });
    const rr = r?.result ?? {};
    cursor = Number(rr.cursor ?? cursor);
    done = !!rr.done;
    console.log(`continue[${i}] done=${done} text=${String(rr.replies?.[0]?.text ?? "").slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  // 3. Direct address by role — the @mention path buyer agents use.
  const b2 = await bind("thread2");
  const r2 = await send({ skill: "crew-thread", task_id: taskId, to: "frontend", text: "Reply with exactly: FRONTEND-OK", buyerAddress: account.address, nonce: b2.nonce, buyerSig: b2.sig });
  const res2 = r2?.result ?? {};
  const hit = (res2.replies ?? []).some((m: any) => String(m.text ?? "").includes("FRONTEND-OK"));
  console.log("direct-to-frontend hit:", hit, JSON.stringify(res2).slice(0, 200));
  if (!hit) throw new Error("direct role address failed");
  console.log("crew-thread chat GREEN");
}

void main();
