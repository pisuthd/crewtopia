/**
 * Extend a live rental via crew-extend → accept → fund.
 * Run: TASK_ID=<uuid> MINUTES=30 npx tsx scripts/a2a/3-crew-extend.ts
 */
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { loadEnv, ERC8183Client, EVMWalletProvider } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorAndFund } from "./anchor";

loadEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));

const BASE = (process.env.API_BASE_URL ?? process.env.A2A_BASE_URL ?? "").replace(/\/+$/, "");
const taskId = process.env.TASK_ID ?? "";
const minutes = Number(process.env.MINUTES ?? 30);
if (!BASE || !taskId) throw new Error("need API_BASE_URL and TASK_ID");
const rawKey = process.env.PRIVATE_KEY;
if (!rawKey) throw new Error("PRIVATE_KEY required");
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
const text = (r: any) => r?.result?.status?.message?.parts?.[0]?.text ?? JSON.stringify(r?.result ?? r?.error ?? r).slice(0, 200);

async function main(): Promise<void> {
  const bind = async (tag: string) => {
    const nonce = `${tag}-${Date.now()}`;
    const sig = await signer.signMessage({ message: `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${nonce}` });
    return { nonce, sig };
  };
  const b0 = await bind("extend");
  const r1 = await send({ skill: "crew-extend", task_id: taskId, minutes, buyerAddress: account.address, nonce: b0.nonce, buyerSig: b0.sig });
  console.log("extend:", text(r1).slice(0, 300));
  // accept returns params; buyer anchors + funds the renewal job
  const buyerClient = await ERC8183Client.create({ walletProvider: new EVMWalletProvider({ password: process.env.WALLET_PASSWORD!, privateKey: rawKey }), network: "bsc-testnet" });
  const { jobId: rj } = await anchorAndFund({ send, bind, buyerClient, buyerAddress: account.address, taskId, tag: "extend-accept" });
  console.log("accept: renewal job anchored + funded, jobId=", rj);
  for (let i = 0; i < 20; i++) {
    const r3 = await send({ skill: "web3-task-status", task_id: taskId });
    const t = text(r3);
    if (t.includes("seconds left") || /~\d+ min left/.test(t)) { console.log("extended:", t.slice(0, 160)); return; }
    await new Promise((r) => setTimeout(r, 30000));
  }
  throw new Error("renewal not credited in time");
}

void main();
