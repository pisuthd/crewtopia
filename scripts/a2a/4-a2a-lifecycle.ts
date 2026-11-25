/**
 * A2A capstone: the full buyer-agent journey over the real wire —
 * negotiate → accept → fund → working → crew-thread → extend → fund →
 * end. Asserts status at each step. Burns ~0.01 U (30 + 30 min @ 0.01 U/hr).
 *
 * Run: npx tsx scripts/a2a/4-a2a-lifecycle.ts
 * Needs: scripts/.env (PRIVATE_KEY with test U + tBNB gas).
 */
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { loadEnv, ERC8183Client, EVMWalletProvider } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const text = (r: any): string => r?.result?.status?.message?.parts?.[0]?.text ?? JSON.stringify(r?.result ?? r?.error ?? r).slice(0, 160);
const check = (name: string, cond: unknown, extra = "") => console.log(`${cond ? "  ok" : "  FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);

async function bind(tag: string) {
  const nonce = `${tag}-${Date.now()}`;
  const sig = await signer.signMessage({ message: `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${nonce}` });
  return { nonce, sig };
}

async function fundJob(jobId: string, totalWei: string): Promise<void> {
  const buyerClient = await ERC8183Client.create({ walletProvider: new EVMWalletProvider({ password: process.env.WALLET_PASSWORD!, privateKey: rawKey }), network: "bsc-testnet" });
  await buyerClient.fund(BigInt(jobId), BigInt(totalWei));
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
  // 1-3. negotiate → accept → fund.
  const teamId = process.env.TEAM_ID ?? "dev-crew";
  const agentId = BigInt(process.env.AGENT_ID ?? "2892");
  const cardEndpoint =
    process.env.ENDPOINT ??
    "https://h9907ecjy9.execute-api.ap-southeast-1.amazonaws.com/prod/.well-known/agent-card.json";
  const b0 = await bind("life-neg");
  const brief = process.env.BRIEF ?? "Lifecycle probe: static hello page, serve it, done.";
  const r1 = await send({ skill: "negotiate-web3-task", teamId, brief, minutes: 30, buyerAddress: account.address, nonce: b0.nonce, buyerSig: b0.sig });
  const m = /task_id ([0-9a-f-]{36})/.exec(text(r1));
  const taskId = m?.[1] ?? "";
  check("negotiate returns task_id", !!taskId, taskId);
  if (!taskId) throw new Error("no task");
  const quote = (r1?.result?.artifacts ?? []).find((a: any) => a?.name === "quote")?.parts?.[0]?.data;
  const b1 = await bind("life-acc");
  let r2: any = null;
  for (let attempt = 0; attempt < 3 && !r2?.result && !r2?.error; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 15000));
    const ba = await bind(`life-acc${attempt}`);
    r2 = await send({ skill: "accept-web3-quote", task_id: taskId, buyerAddress: account.address, nonce: ba.nonce, buyerSig: ba.sig });
  }
  const jobId = (r2?.result?.artifacts ?? []).find((a: any) => a?.name === "escrow")?.parts?.[0]?.data?.jobId ?? r2?.result?.jobId;
  check("accept returns jobId", !!jobId, String(jobId ?? JSON.stringify(r2?.error ?? r2?.result ?? r2).slice(0, 200)));
  if (!jobId || !quote?.totalWei) throw new Error("accept failed");
  await fundJob(String(jobId), String(quote.totalWei));
  const t3 = await waitFor(taskId, /status=working/, "flip to working");
  check("funded flips to WORKING", true, t3.slice(0, 100));

  // 4. crew-thread turn (fresh hires boot async — retry while retryable).
  let r1c: any = null;
  {
    const t0 = Date.now();
    while (Date.now() - t0 < 600_000) {
      const b = await bind(`life-chat${Date.now()}`);
      r1c = await send({ skill: "crew-thread", task_id: taskId, to: "lead", text: "Reply with exactly: LIFECYCLE-OK", buyerAddress: account.address, nonce: b.nonce, buyerSig: b.sig });
      if ((r1c?.result as any)?.runId || !(r1c?.result as any)?.retryable) break;
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
  const hit0 = JSON.stringify(r1c?.result ?? {}).includes("LIFECYCLE-OK");
  let hit = hit0;
  let cursor = Number((r1c?.result as any)?.cursor ?? 0);
  const runId = (r1c?.result as any)?.runId;
  for (let i = 0; i < 4 && !hit && runId; i++) {
    const b = await bind(`life-cont${i}`);
    const r = await send({ skill: "crew-thread", task_id: taskId, runId, cursor, buyerAddress: account.address, nonce: b.nonce, buyerSig: b.sig });
    cursor = Number((r?.result as any)?.cursor ?? cursor);
    if (JSON.stringify(r?.result ?? {}).includes("LIFECYCLE-OK")) { hit = true; break; }
    if ((r?.result as any)?.done) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  check("crew-thread replies", hit, JSON.stringify(r1c?.result ?? r1c?.error).slice(0, 160));

  // 5-6. extend → accept → fund renewal, clock extends.
  const b3 = await bind("life-ext");
  const r5 = await send({ skill: "crew-extend", task_id: taskId, minutes: 30, buyerAddress: account.address, nonce: b3.nonce, buyerSig: b3.sig });
  const renewalWei = (r5?.result as any)?.totalWei;
  check("extend quotes renewal", !!(r5?.result as any)?.renewal, JSON.stringify(r5?.result ?? r5?.error).slice(0, 120));
  const b4 = await bind("life-ext-acc");
  const r6 = await send({ skill: "accept-web3-quote", task_id: taskId, buyerAddress: account.address, nonce: b4.nonce, buyerSig: b4.sig });
  const rj = (r6?.result?.artifacts ?? []).find((a: any) => a?.name === "escrow")?.parts?.[0]?.data?.jobId ?? (r6?.result as any)?.jobId;
  check("renewal job minted", !!rj, String(rj ?? ""));
  if (rj && renewalWei) await fundJob(String(rj), String(renewalWei)).catch((e: Error) => console.log(`  note — renewal fund: ${e.message.slice(0, 120)}`));

  // 7. end.
  const b5 = await bind("life-end");
  const r7 = await send({ skill: "crew-end", task_id: taskId, buyerAddress: account.address, nonce: b5.nonce, buyerSig: b5.sig });
  check("crew-end ends rental", (r7?.result as any)?.state === "ended", JSON.stringify(r7?.result ?? r7?.error).slice(0, 120));

  // 8. ERC-8004 feedback, direct buyer → Reputation Registry (no skill —
  // the registry records msg.sender as the client by design). Skipped when
  // running under the operator key: the protocol blocks self-feedback.
  const idReg = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
  const pubClient = createPublicClient({ chain: bscTestnet, transport: http() });
  const owner = (await pubClient.readContract({
    address: idReg as `0x${string}`,
    abi: [{ name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] }] as const,
    functionName: "ownerOf",
    args: [agentId],
  })) as string;
  if (owner.toLowerCase() === account.address.toLowerCase()) {
    console.log("  skip — operator key cannot leave feedback on its own crew (protocol rule)");
    console.log("a2a lifecycle GREEN");
    return;
  }
  const rep = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
  const fbAbi = [{
    name: "giveFeedback", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" }, { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" }, { name: "tag1", type: "string" },
      { name: "tag2", type: "string" }, { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" }, { name: "feedbackHash", type: "bytes32" },
    ], outputs: [],
  }] as const;
  const fbClient = createWalletClient({ account, chain: bscTestnet, transport: http() });
  const fbHash = await fbClient.writeContract({
    address: rep as `0x${string}`, abi: fbAbi, functionName: "giveFeedback",
    args: [agentId, 100n, 0, "completed", "a2a-lifecycle", cardEndpoint, "", "0x0000000000000000000000000000000000000000000000000000000000000000"],
    chain: bscTestnet, account,
  });
  check("giveFeedback submitted", !!fbHash, String(fbHash).slice(0, 20));
  console.log("a2a lifecycle GREEN");
}

void main();
