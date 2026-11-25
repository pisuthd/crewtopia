/**
 * 10-feedback — real ERC-8004 feedback: buyer calls giveFeedback on the
 * Reputation Registry (BSC testnet), then verifies via getSummary.
 * No SDK reputation client needed — direct contract call with viem.
 *
 * Run:  npm run test:10   (needs scripts/.env PRIVATE_KEY + settled job:
 *   scripts/.last-job.json from scripts 7+9, or JOB_ID + AGENT_ID env)
 *
 * NOTE — 8004 blocks owner/operator self-feedback on-chain. The default
 * PRIVATE_KEY is our operator key, so a write with it reverts with
 * "Self-feedback not allowed" (correct protocol behavior). For a live
 * write, set FEEDBACK_KEY to a NON-operator buyer wallet with tBNB gas.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, getAddress, http, keccak256, publicActions, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { loadEnv } from "@bnbagent/sdk";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadEnv(join(ROOT, ".."));

const REPUTATION_REGISTRY = getAddress("0x8004B663056A597Dffe9eCcC1965A193B7388713");
const GIVE_FEEDBACK_ABI = [
  {
    name: "giveFeedback",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "getSummary",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
  },
] as const;

async function main(): Promise<void> {
  const rawKey = ((process.env.FEEDBACK_KEY ?? process.env.PRIVATE_KEY) ?? "") as `0x${string}`;
  if (!rawKey) throw new Error("PRIVATE_KEY (or FEEDBACK_KEY) required in scripts/.env");
  const account = privateKeyToAccount(rawKey);
  const client = createWalletClient({ account, chain: bscTestnet, transport: http() }).extend(publicActions);

  let agentId = Number(process.env.AGENT_ID ?? 0);
  let jobId = process.env.JOB_ID ?? "";
  let settleTx = "";
  const store = join(ROOT, "..", ".last-job.json");
  if (existsSync(store) && (!agentId || !jobId)) {
    const saved = JSON.parse(readFileSync(store, "utf8")) as { jobId?: string; agentId?: number; price?: string; network?: string; settleTx?: string };
    agentId = agentId || saved.agentId || 2892;
    jobId = jobId || saved.jobId || "";
    settleTx = saved.settleTx ?? "";
  }
  agentId = agentId || 2892;
  const price = Number(process.env.PRICE ?? 100);
  const tag2 = process.env.TAG2 ?? "happy-path";

  // Feedback file hash (off-chain payload reference): keccak of a small receipt.
  const receipt = JSON.stringify({ agentId, jobId, client: account.address, value: price, tag1: "completed", tag2, settleTx, at: new Date().toISOString() });
  const feedbackHash = keccak256(toHex(receipt));

  const hash = await client.writeContract({
    address: REPUTATION_REGISTRY,
    abi: GIVE_FEEDBACK_ABI,
    functionName: "giveFeedback",
    args: [BigInt(agentId), BigInt(price), 0, "completed", tag2, "https://h9907ecjy9.execute-api.ap-southeast-1.amazonaws.com/prod/.well-known/agent-card.json", "", feedbackHash],
    chain: bscTestnet,
    account,
  });
  console.log(`[10-feedback] giveFeedback tx: ${hash} (agent ${agentId}, value ${price})`);
  const rcpt: any = await client.waitForTransactionReceipt({ hash });
  console.log(`[10-feedback] mined in block ${rcpt.blockNumber} status=${rcpt.status}`);

  const summary: any = await client.readContract({
    address: REPUTATION_REGISTRY,
    abi: GIVE_FEEDBACK_ABI,
    functionName: "getSummary",
    args: [BigInt(agentId), [account.address], "completed", tag2],
  });
  const [count, sumVal, sumDec] = summary as [bigint, bigint, number];
  console.log(`[10-feedback] summary: count=${count} value=${sumVal} decimals=${sumDec}`);
  if (Number(count) < 1) throw new Error("feedback not visible in getSummary");
  console.log("[10-feedback] GREEN — on-chain ERC-8004 feedback verified");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
