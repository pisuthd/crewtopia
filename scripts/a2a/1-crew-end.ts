/**
 * End a rental via the crew-end skill (buyer-signed).
 * Run: TASK_ID=<uuid> npx tsx scripts/a2a/2-crew-end.ts
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
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "message/send",
      params: { message: { messageId: crypto.randomUUID(), role: "user", parts: [{ kind: "data", data }] } },
    }),
  });
  return res.json();
}

async function main(): Promise<void> {
  const nonce = `end-${Date.now()}`;
  const sig = await signer.signMessage({ message: `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${nonce}` });
  const r = await send({ skill: "crew-end", task_id: taskId, buyerAddress: account.address, nonce, buyerSig: sig });
  console.log(JSON.stringify(r?.result ?? r?.error ?? r, null, 2).slice(0, 600));
}

void main();
