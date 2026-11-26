/**
 * A2A voice-link: the seller-agent loop — hire Voice Crew, mint a guest Talk
 * URL over A2A, verify it resolves publicly, end the rental, verify the link
 * dies with it. No UI anywhere.
 *
 * Run: npx a2a/6-voice-link.ts            (hires fresh, ~0.01 U)
 *      TASK_ID=<uuid> npx a2a/6-voice-link.ts  (reuse a WORKING rental)
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
const API = "https://h9907ecjy9.execute-api.ap-southeast-1.amazonaws.com/prod";
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
const resultOf = (r: any) => (r?.result?.status?.message?.parts?.[0]?.data ?? r?.result ?? {}) as any;

async function bind(tag: string) {
  const nonce = `${tag}-${Date.now()}`;
  const sig = await signer.signMessage({ message: `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${nonce}` });
  return { nonce, sig };
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
  let taskId = process.env.TASK_ID ?? "";
  if (!taskId) {
    const brief = "Maple & Rye catering hotline: quote office lunches for thirty, hold Friday slots, confirm nut allergies.";
    const b0 = await bind("vlink-neg");
    const r1 = await send({ skill: "negotiate-web3-task", teamId: "voice-crew", brief, minutes: 30, buyerAddress: account.address, nonce: b0.nonce, buyerSig: b0.sig });
    const m = /task_id ([0-9a-f-]{36})/.exec(text(r1));
    taskId = m?.[1] ?? "";
    check("negotiate returns task_id", !!taskId, taskId);
    if (!taskId) throw new Error("no task");
    const quote = (r1?.result?.artifacts ?? []).find((a: any) => a?.name === "quote")?.parts?.[0]?.data;
    if (!quote?.totalWei) throw new Error("negotiate failed: " + text(r1).slice(0, 200));
    const buyerClient = await ERC8183Client.create({ walletProvider: new EVMWalletProvider({ password: process.env.WALLET_PASSWORD!, privateKey: rawKey }), network: "bsc-testnet" });
    const { jobId } = await anchorAndFund({ send, bind, buyerClient, buyerAddress: account.address, taskId, tag: "vlink-acc" });
    check("accept + anchor returns jobId", !!jobId, String(jobId));
    const t3 = await waitFor(taskId, /status=working/, "flip to working");
    check("funded flips to WORKING", true, t3.slice(0, 80));
  } else {
    console.log(`  reusing TASK_ID=${taskId}`);
  }

  // Mint the guest link over A2A.
  const b2 = await bind("vlink-mint");
  const r3 = await send({ skill: "crew-voice-link", task_id: taskId, buyerAddress: account.address, nonce: b2.nonce, buyerSig: b2.sig });
  const got = resultOf(r3);
  const linkId = String(got.linkId ?? "");
  const url = String(got.url ?? got.path ?? "");
  check("crew-voice-link mints link", /^[0-9a-f-]{36}$/.test(linkId), `linkId=${linkId} url=${url}`);
  if (!linkId) throw new Error(`mint failed: ${JSON.stringify(r3?.error ?? r3?.result).slice(0, 200)}`);

  // The link resolves publicly (guest-config, no auth).
  const cfg = await fetch(`${API}/rent/io/voice/guest-config?linkId=${encodeURIComponent(linkId)}`).then((r) => r.json()).catch(() => null);
  check("guest link resolves publicly", !!cfg && /voice/i.test(String(cfg.team ?? "")), `team=${cfg?.team}`);

  // End the rental → the link must die with it (guest-token 409).
  const b5 = await bind("vlink-end");
  const r7 = await send({ skill: "crew-end", task_id: taskId, buyerAddress: account.address, nonce: b5.nonce, buyerSig: b5.sig });
  check("crew-end ends rental", (r7?.result as any)?.state === "ended", String((r7?.result as any)?.state ?? ""));
  const tokRes = await fetch(`${API}/rent/io/voice/guest-token?linkId=${encodeURIComponent(linkId)}`);
  // 404 = link revoked at end (lookup misses); 409 = link known but rental
  // not working. Either way no token mints — the link is dead.
  check("link dead after end", tokRes.status === 404 || tokRes.status === 409, `guest-token -> ${tokRes.status}`);

  console.log("voice-link GREEN");
}

void main();
