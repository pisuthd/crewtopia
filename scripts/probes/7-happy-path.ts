/**
 * 7-happy-path — full job lifecycle: create → register → setBudget →
 * fund → submit → SUBMITTED. Settle comes later (script 9, after the
 * 15-min dispute window).
 *
 * Balance precheck: reads the U balance first. If it covers PRICE_U
 * (default 0.01), runs the FUNDED flow; otherwise runs the zero-price
 * variant (budget 0 — moves no tokens, still exercises the whole
 * lifecycle). Same wallet plays client + provider (testnet self-deal).
 *
 * Run:  npm run test:7
 * Env:  PRIVATE_KEY, WALLET_PASSWORD, NETWORK (default bsc-testnet),
 *         TASK (default "Build a landing page preview"), TEAM (default
 *         "crewtopia-dev-crew"), PRICE_U (default "0.01")
 * Saves: .last-job.json { jobId, price, network } for script 9.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatUnits, keccak256, parseUnits, stringToHex } from "viem";
import { ERC8183Client, JobStatus } from "@bnbagent/sdk/erc8183";
import { EVMWalletProvider, loadEnv } from "@bnbagent/sdk";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadEnv(join(ROOT, ".."));

async function main(): Promise<void> {
  const network = (process.env.NETWORK ?? "bsc-testnet") as "bsc-testnet" | "bsc-mainnet";
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY is required in scripts/.env");
  const password = process.env.WALLET_PASSWORD;
  if (!password) throw new Error("WALLET_PASSWORD is required in scripts/.env");
  const task = process.env.TASK ?? "Build a landing page preview";
  const team = process.env.TEAM ?? "crewtopia-dev-crew";

  const wallet = new EVMWalletProvider({ password, privateKey });
  const client = await ERC8183Client.create({ walletProvider: wallet, network });
  const me = wallet.address;
  console.log(`[7-happy-path] network=${network} wallet=${me}`);

  const paymentToken = await client.paymentToken();
  const decimals = await client.tokenDecimals();
  const rawBal: bigint = await client.publicClient.readContract({
    address: paymentToken,
    abi: [
      { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
    ],
    functionName: "balanceOf",
    args: [me],
  } as never) as bigint;
  console.log(`  U balance: ${formatUnits(rawBal, decimals)} (token ${paymentToken})`);

  const want = parseUnits(process.env.PRICE_U ?? "0.01", decimals);
  const price = rawBal >= want && want > 0n ? want : 0n;
  console.log(
    price > 0n
      ? `  price: ${formatUnits(price, decimals)} U (FUNDED flow)`
      : `  price: 0 (ZERO-PRICE flow — moves no tokens)`,
  );

  const disputeWindow = await client.policy.disputeWindow();
  const expiredAt = BigInt(Math.floor(Date.now() / 1000)) + disputeWindow + 600n;
  const description = JSON.stringify({ task, team, network });

  const created = await client.createJob({ provider: me, expiredAt, description });
  if (created.jobId === null) throw new Error("createJob did not return a jobId");
  const jobId = created.jobId;
  console.log(`  createJob → job ${jobId} (${created.transactionHash})`);

  await client.registerJob(jobId);
  console.log("  registerJob → policy bound");
  await client.setBudget(jobId, price);
  console.log(`  setBudget → ${formatUnits(price, decimals)} U`);
  const funded = await client.fund(jobId, price);
  console.log(`  fund → ${funded.transactionHash ?? "ok"}`);

  const manifest = { jobId: jobId.toString(), task, team, price: price.toString(), network };
  const manifestJson = JSON.stringify(manifest);
  const dataDir = join(ROOT, "..", ".agent-data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, `job-${jobId}.json`), manifestJson + "\n");
  const submitted = await client.submit(jobId, keccak256(stringToHex(manifestJson)), {
    deliverable_url: `file://${join(dataDir, `job-${jobId}.json`)}`,
  });
  console.log(`  submit → ${submitted.transactionHash}`);

  const job = await client.getJob(jobId);
  console.log(`  status: ${JobStatus[Number(job.status)]} (budget ${formatUnits(job.budget, decimals)} U)`);
  if (Number(job.status) !== JobStatus.SUBMITTED) {
    throw new Error(`Expected SUBMITTED, got ${JobStatus[Number(job.status)]}`);
  }

  writeFileSync(
    join(ROOT, "..", ".last-job.json"),
    JSON.stringify({ jobId: jobId.toString(), price: price.toString(), network, txs: { create: created.transactionHash } }, null, 2) + "\n",
  );
  console.log("\nOK — job FUNDED + SUBMITTED. Wait out the dispute window, then: npm run test:9");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});


// PS C:\projects\crewtopia\scripts> npm run test:7

// > crewtopia-scripts@0.1.0 test:7
// > tsx 7-happy-path.ts

// [7-happy-path] network=bsc-testnet wallet=0x971F6680a20671458d456656081ea8e32102a64e
//   U balance: 9.99 (token 0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565)
//   price: 0.01 U (FUNDED flow)
//   createJob → job 1743 (0x2c173f340ed2a08b435b3083e6a240705d97770c5a79222740bbe07ecc5b9ac3)
//   registerJob → policy bound
//   setBudget → 0.01 U
//   fund → 0x7e1118ecece87d2cc38fbebd6e453e379fdb8b39bdfc80d0298a37cdaaf5e08a
//   submit → 0x184029c7dead2a816f9210c24272f0076e40d8cd1a392ad06839803c12c8c02a
//   status: SUBMITTED (budget 0.01 U)

// OK — job FUNDED + SUBMITTED. Wait out the dispute window, then: npm run test:9
// PS C:\projects\crewtopia\scripts>