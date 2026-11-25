/** Minimal A2A hire: negotiate → accept → fund → working. Leaves rental running. */
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { loadEnv, ERC8183Client, EVMWalletProvider } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

loadEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));
const BASE = (process.env.API_BASE_URL ?? "").replace(/\/+$/, "");
const account = privateKeyToAccount((process.env.PRIVATE_KEY as `0x${string}`));
const signer = createWalletClient({ account, chain: bscTestnet, transport: http() });

async function send(data: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE}/a2a/message/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "message/send", params: { message: { messageId: crypto.randomUUID(), role: "user", parts: [{ kind: "data", data }] } } }),
  });
  return res.json();
}
const text = (r: any): string => r?.result?.status?.message?.parts?.[0]?.text ?? String(JSON.stringify(r?.result ?? r?.error ?? r)).slice(0, 200);

async function main(): Promise<void> {
  const bind = async (t: string) => {
    const nonce = `${t}-${Date.now()}`;
    return { nonce, sig: await signer.signMessage({ message: `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${nonce}` }) };
  };
  const b0 = await bind("h");
  const r1 = await send({ skill: "negotiate-web3-task", teamId: "dev-crew", brief: "Debug probe: static hello page, serve it.", minutes: 30, buyerAddress: account.address, nonce: b0.nonce, buyerSig: b0.sig });
  const taskId = /task_id ([0-9a-f-]{36})/.exec(text(r1))?.[1];
  if (!taskId) throw new Error("no task: " + text(r1).slice(0, 200));
  console.log("task:", taskId);
  const quote = (r1?.result?.artifacts ?? []).find((a: any) => a?.name === "quote")?.parts?.[0]?.data;
  const b1 = await bind("a");
  const r2 = await send({ skill: "accept-web3-quote", task_id: taskId, buyerAddress: account.address, nonce: b1.nonce, buyerSig: b1.sig });
  const jobId: string | undefined = r2?.result?.artifacts?.find((a: any) => a?.name === "escrow")?.parts?.[0]?.data?.jobId ?? r2?.result?.jobId;
  if (!jobId || !quote?.totalWei) throw new Error("accept failed: " + text(r2).slice(0, 200));
  console.log("job:", jobId);
  const buyerClient = await ERC8183Client.create({ walletProvider: new EVMWalletProvider({ password: process.env.WALLET_PASSWORD!, privateKey: process.env.PRIVATE_KEY! }), network: "bsc-testnet" });
  await buyerClient.fund(BigInt(jobId), BigInt(quote.totalWei));
  for (let i = 0; i < 20; i++) {
    const r3 = await send({ skill: "web3-task-status", task_id: taskId });
    if (text(r3).includes("status=working")) { console.log("WORKING", taskId); writeFileSync(join(dirname(fileURLToPath(import.meta.url)), ".last-a2a-task.json"), JSON.stringify({ taskId, jobId }) + "\n"); return; }
    await new Promise((r) => setTimeout(r, 30000));
  }
  throw new Error("never flipped");
}
void main();
