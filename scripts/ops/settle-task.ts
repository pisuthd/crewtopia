/**
 * ops/settle-task — post-window completion for a hired task.
 * Sends web3-deliver/settle (provider-signed); asserts COMPLETED, or prints
 * the retry-in guidance when the dispute window is still open.
 *
 * Run:  TASK_ID=<uuid> npm run ops:settle
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { loadEnv } from "@bnbagent/sdk";

loadEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));

const BASE =
  process.env.A2A_BASE_URL ?? "https://8lgt6x9mn8.execute-api.ap-southeast-1.amazonaws.com/prod";

async function main() {
  const taskId = process.env.TASK_ID;
  if (!taskId) throw new Error("TASK_ID is required");
  const rawKey = process.env.PRIVATE_KEY;
  if (!rawKey) throw new Error("PRIVATE_KEY required in scripts/.env (team operator wallet)");
  const account = privateKeyToAccount(rawKey as `0x${string}`);
  const signer = createWalletClient({ account, chain: bscTestnet, transport: http() });

  const nonce = `settle-${Date.now()}`;
  const providerSig = await signer.signMessage({ message: `Crewtopia deliver v1\ntask: ${taskId}\naction: settle\nnonce: ${nonce}` });
  const res = await fetch(`${BASE}/a2a/message/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { messageId: crypto.randomUUID(), role: "user", parts: [{ kind: "data", data: { skill: "web3-deliver", task_id: taskId, action: "settle", providerAddress: account.address, nonce, providerSig } }] } } }),
  });
  const reply = (await res.json()) as any;
  if (reply?.error) throw new Error(reply.error.message);
  const text: string = reply?.result?.status?.message?.parts?.[0]?.text ?? "";
  console.log(text);
  if (!text.includes("COMPLETED")) process.exit(2);
  console.log("\nOK — hired task COMPLETED, escrow released.");
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
