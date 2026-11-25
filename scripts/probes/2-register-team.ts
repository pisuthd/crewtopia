/**
 * 2-register-team — mint the team's ERC-8004 identity (one-time per team).
 *
 * No A2A endpoint yet: the SDK requires at least one endpoint entry, so we
 * register a placeholder `web` endpoint (plain metadata, never fetched).
 * The real A2A endpoint is attached later via setAgentURI once the team
 * service is live.
 *
 * About the two secrets (see scripts/.env.example):
 *   PRIVATE_KEY     — your testnet key. First run only: the SDK encrypts it
 *                     into ~/.bnbagent/wallets/<address>.json, then you
 *                     REMOVE it from .env. The chain never sees a password.
 *   WALLET_PASSWORD — any string. Local keystore encryption only, never
 *                     sent anywhere. Needed every run to unlock the keystore.
 *
 * Run:  npm run test:2
 * Saves: .agent-ids.json { <AGENT_NAME>: { agentId, tx, network } }
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentEndpoint, ERC8004Agent, EVMWalletProvider, loadEnv } from "@bnbagent/sdk";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadEnv(join(ROOT, ".."));

async function main(): Promise<void> {
  const network = (process.env.NETWORK ?? "bsc-testnet") as "bsc-testnet" | "bsc-mainnet";
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY is required in scripts/.env (first run only)");
  const password = process.env.WALLET_PASSWORD;
  if (!password) throw new Error("WALLET_PASSWORD is required in scripts/.env (any string)");
  const name = process.env.AGENT_NAME ?? "crewtopia-probe-01";
  const description =
    process.env.AGENT_DESCRIPTION ??
    "Crewtopia registration probe: throwaway test identity, not a real team.";

  const wallet = new EVMWalletProvider({ password, privateKey });
  const sdk = await ERC8004Agent.create({ walletProvider: wallet, network });
  console.log(`[2-register-team] network=${network} wallet=${sdk.walletAddress}`);

  const agentUri = sdk.generateAgentUri({
    name,
    description,
    // Placeholder until the team service exists (see header). Real A2A
    // endpoint replaces this via setAgentURI later.
    endpoints: [new AgentEndpoint({ name: "web", endpoint: "https://crewtopia.xyz" })],
  });
  const result = await sdk.registerAgent(agentUri);

  console.log(`  tx:       ${result.transactionHash}`);
  console.log(`  agent_id: ${result.agentId}`);

  const idsPath = join(ROOT, "..", ".agent-ids.json");
  const ids = existsSync(idsPath)
    ? (JSON.parse(readFileSync(idsPath, "utf8")) as Record<string, unknown>)
    : {};
  ids[name] = { agentId: Number(result.agentId), tx: result.transactionHash, network };
  writeFileSync(idsPath, JSON.stringify(ids, null, 2) + "\n");
  console.log(`  saved:    .agent-ids.json → ${name}`);
  console.log("\nNext: put this agentId on the Web3 Development team card, then 3-get-agent.ts");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
