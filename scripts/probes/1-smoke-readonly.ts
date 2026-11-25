/**
 * 1-smoke-readonly — run this FIRST.
 *
 * Read-only live check against BNB Chain testnet. Validates RPC reachability,
 * chainId match, and that the SDK's ABI wiring agrees with the real on-chain
 * contracts. Signs nothing, sends no transactions, spends no gas.
 *
 * Run:  npm run test:1
 *   (or: npx tsx 1-smoke-readonly.ts)
 *
 * Env (all optional):
 *   NETWORK=bsc-testnet (default) | bsc-mainnet
 *   RPC_URL_BSC_TESTNET / RPC_URL_BSC_MAINNET — override the default RPC
 */
import { ERC8183Client } from "@bnbagent/sdk";

const NETWORK = (process.env.NETWORK ?? "bsc-testnet") as "bsc-testnet" | "bsc-mainnet";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(22)} ${String(value)}`);
}

async function main(): Promise<void> {
  console.log(`[1-smoke-readonly] network=${NETWORK}\n`);

  // Read-only construction: no wallet. create() asserts the RPC's reported
  // chainId matches the network preset — if this throws, the RPC is wrong
  // or unreachable.
  const client = await ERC8183Client.create({ network: NETWORK });
  console.log("client constructed (read-only, chainId assertion passed)\n");

  console.log("Commerce kernel:");
  const [jobCounter, paymentToken, feeBp, treasury] = await Promise.all([
    client.commerce.jobCounter(),
    client.paymentToken(),
    client.commerce.platformFeeBp(),
    client.commerce.platformTreasury(),
  ]);
  line("jobCounter", jobCounter);
  line("paymentToken", paymentToken);
  line("platformFeeBp", feeBp);
  line("platformTreasury", treasury);

  console.log("\nPolicy (dispute timing — needed to plan the demo settle):");
  const disputeWindow = await client.policy.disputeWindow();
  line("disputeWindow(s)", disputeWindow);
  line("disputeWindow", `${Number(disputeWindow) / 3600}h`);

  console.log("\nPayment token:");
  line("decimals", await client.tokenDecimals());

  assert(jobCounter !== undefined, "jobCounter readable");
  assert(paymentToken.startsWith("0x"), "paymentToken is an address");
  console.log("\nOK — RPC + ABIs agree with the chain. Next: 2-register-team.ts");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
