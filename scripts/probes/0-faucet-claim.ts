/**
 * 0-faucet-claim — setup step, run before everything else.
 *
 * Claims test U (United Stables) from the official faucet contract for the
 * scripts/.env wallet. Skips gracefully when the balance already covers
 * FAUCET_MIN_U (default 1) — safe to re-run anytime. The faucet enforces a
 * ~30-min cooldown between claims; a cooldown revert prints as a friendly
 * "try later" instead of a stack trace.
 *
 * Run:  npm run test:0
 * Env:  PRIVATE_KEY, WALLET_PASSWORD (unused — viem signs directly),
 *         NETWORK (default bsc-testnet), FAUCET_MIN_U (default "1")
 * Faucet: https://united-coin-u.github.io/u-faucet/ (same contract, on-chain)
 */
import { formatUnits, getAddress, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@bnbagent/sdk";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadEnv(join(ROOT, ".."));

const FAUCET = getAddress("0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3");
const FAUCET_ABI = [
  { type: "function", name: "tokenInstance", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tokenAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "requestTokens", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;
const ERC20_BALANCE_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

async function main(): Promise<void> {
  const network = process.env.NETWORK ?? "bsc-testnet";
  if (network !== "bsc-testnet") throw new Error("The U faucet lives on bsc-testnet only");
  const chain = bscTestnet;
  const rawKey = process.env.PRIVATE_KEY;
  if (!rawKey) throw new Error("PRIVATE_KEY is required in scripts/.env");
  const account = privateKeyToAccount(rawKey as `0x${string}`);
  const transport = http();
  const pc = createPublicClient({ chain, transport });

  const token = getAddress(await pc.readContract({ address: FAUCET, abi: FAUCET_ABI, functionName: "tokenInstance" }));
  const drip = (await pc.readContract({ address: FAUCET, abi: FAUCET_ABI, functionName: "tokenAmount" })) as bigint;
  const bal = (await pc.readContract({
    address: token, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [account.address],
  })) as bigint;
  const min = parseUnits(process.env.FAUCET_MIN_U ?? "1", 18);
  console.log(`[0-faucet-claim] wallet=${account.address}`);
  console.log(`  faucet token: ${token} (drip ${formatUnits(drip, 18)} U)`);
  console.log(`  U balance: ${formatUnits(bal, 18)}`);

  if (bal >= min) {
    console.log(`  already funded (>= ${formatUnits(min, 18)} U) — skipping claim. Next: npm run test:1`);
    return;
  }

  console.log("  balance low — claiming from faucet…");
  const wc = createWalletClient({ account, chain, transport });
  try {
    const hash = await wc.writeContract({ address: FAUCET, abi: FAUCET_ABI, functionName: "requestTokens" });
    const receipt = await pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`claim tx reverted: ${hash}`);
    const after = (await pc.readContract({
      address: token, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [account.address],
    })) as bigint;
    console.log(`  claimed. tx=${hash}`);
    console.log(`  U balance: ${formatUnits(after, 18)}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/revert|denied|wait|cooldown|allowed/i.test(msg)) {
      console.log("  faucet refused (likely 30-min cooldown) — try again later. No funds moved.");
      return;
    }
    throw error;
  }
  console.log("\nOK — wallet funded. Next: npm run test:1");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
