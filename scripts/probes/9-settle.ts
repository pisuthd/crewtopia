/**
 * 9-settle — close the job from script 7: settle → COMPLETED.
 *
 * Permissionless: anyone can pull the policy verdict on-chain; we settle
 * with our own wallet for simplicity. Must run AFTER the dispute window
 * (15 min on testnet) elapses — run too early and the script tells you
 * exactly when to retry instead of dumping a revert.
 *
 * Run:  npm run test:9   (reads scripts/.last-job.json from script 7)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ERC8183Client, JobStatus } from "@bnbagent/sdk/erc8183";
import { EVMWalletProvider, loadEnv } from "@bnbagent/sdk";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadEnv(join(ROOT, ".."));

async function main(): Promise<void> {
  const store = join(ROOT, "..", ".last-job.json");
  if (!existsSync(store)) throw new Error("No .last-job.json — run script 7 first");
  const saved = JSON.parse(readFileSync(store, "utf8")) as { jobId: string; network: "bsc-testnet" | "bsc-mainnet" };
  const jobId = BigInt(saved.jobId);

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY is required in scripts/.env");
  const password = process.env.WALLET_PASSWORD;
  if (!password) throw new Error("WALLET_PASSWORD is required in scripts/.env");

  const wallet = new EVMWalletProvider({ password, privateKey });
  const client = await ERC8183Client.create({ walletProvider: wallet, network: saved.network });
  const job = await client.getJob(jobId);
  const status = Number(job.status);
  console.log(`[9-settle] job ${jobId} status=${JobStatus[status]}`);

  if (status === JobStatus.COMPLETED) {
    console.log("  already COMPLETED — nothing to do. Next: npm run test:10");
    return;
  }
  if (status !== JobStatus.SUBMITTED) {
    throw new Error(`Can only settle a SUBMITTED job (current: ${JobStatus[status]})`);
  }

  const window = await client.policy.disputeWindow();
  const eligibleAt = Number(job.submittedAt) + Number(window);
  const now = Math.floor(Date.now() / 1000);
  if (now < eligibleAt) {
    const wait = Math.ceil((eligibleAt - now) / 60);
    console.log(`  dispute window still open — retry in ~${wait} min (eligible ${new Date(eligibleAt * 1000).toISOString()})`);
    return;
  }

  const settled = await client.settle(jobId);
  console.log(`  settle → ${settled.transactionHash}`);
  const after = await client.getJob(jobId);
  console.log(`  status: ${JobStatus[Number(after.status)]}`);

  writeFileSync(store, JSON.stringify({ ...saved, settleTx: settled.transactionHash }, null, 2) + "\n");
  console.log("\nOK — job COMPLETED, escrow released. Next: npm run test:10");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
