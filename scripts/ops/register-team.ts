/**
 * ops/register-team — register the (dry-run or real) team agent.
 *
 * Unlike probes/2-register-team.ts (placeholder endpoint), this attaches the
 * REAL A2A endpoint via AgentEndpoint.a2a(baseUrl), so the on-chain record
 * points at the live AgentCard from day one.
 *
 * Env (scripts/.env): NETWORK, PRIVATE_KEY (first run), WALLET_PASSWORD,
 *   AGENT_NAME (default wayfind-dev-team),
 *   AGENT_DESCRIPTION, A2A_BASE_URL (default: deployed backend-cdk ApiUrl).
 *
 * Run:  AGENT_NAME=wayfind-dev-team npm run ops:register
 * Saves: scripts/.agent-ids.json { <AGENT_NAME>: { agentId, tx, network } }
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentEndpoint, ERC8004Agent, EVMWalletProvider, loadEnv } from "@bnbagent/sdk";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
loadEnv(ROOT);

async function main(): Promise<void> {
  const network = (process.env.NETWORK ?? "bsc-testnet") as "bsc-testnet" | "bsc-mainnet";
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY is required in scripts/.env (first run only)");
  const password = process.env.WALLET_PASSWORD;
  if (!password) throw new Error("WALLET_PASSWORD is required in scripts/.env (any string)");
  const name = process.env.AGENT_NAME ?? "wayfind-dev-team";
  const description =
    process.env.AGENT_DESCRIPTION ??
    "Web3 development team for hire (dry run): PM, UX/UI, frontend, backend. Quotes in U, work secured by ERC-8183 escrow.";
  const baseUrl =
    process.env.A2A_BASE_URL ?? "https://8lgt6x9mn8.execute-api.ap-southeast-1.amazonaws.com/prod";

  const wallet = new EVMWalletProvider({ password, privateKey });
  const sdk = await ERC8004Agent.create({ walletProvider: wallet, network });
  console.log(`[ops/register-team] network=${network} wallet=${sdk.walletAddress}`);

  const agentUri = sdk.generateAgentUri({
    name,
    description,
    endpoints: [AgentEndpoint.a2a(baseUrl)],
  });
  const result = await sdk.registerAgent(agentUri);

  console.log(`  tx:       ${result.transactionHash}`);
  console.log(`  agent_id: ${result.agentId}`);
  console.log(`  card:     ${baseUrl}/.well-known/agent-card.json`);

  const idsPath = join(ROOT, ".agent-ids.json");
  const ids = existsSync(idsPath)
    ? (JSON.parse(readFileSync(idsPath, "utf8")) as Record<string, unknown>)
    : {};
  ids[name] = { agentId: Number(result.agentId), tx: result.transactionHash, network };
  writeFileSync(idsPath, JSON.stringify(ids, null, 2) + "\n");
  console.log(`  saved:    .agent-ids.json → ${name}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
