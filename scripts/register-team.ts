/**
 * register-team — register the (dry-run or real) team agent.
 *
 * Unlike probes/2-register-team.ts (placeholder endpoint), this attaches the
 * REAL team-scoped AgentCard URL via AgentEndpoint.a2a(cardUrl), so the on-chain record
 * points at the live AgentCard from day one.
 *
 * Env (scripts/.env): NETWORK, PRIVATE_KEY (first run), WALLET_PASSWORD,
 *   AGENT_NAME (default wayfind-dev-team),
 *   AGENT_DESCRIPTION, TEAM_ID (default: AGENT_NAME minus crewtopia- prefix),
 *   A2A_BASE_URL (default: deployed backend-cdk ApiUrl).
 *
 * Run:  AGENT_NAME=crewtopia-dev-crew npm run register-team
 * Saves: scripts/.agent-ids.json { <AGENT_NAME>: { agentId, tx, network } }
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentEndpoint, ERC8004Agent, EVMWalletProvider, loadEnv } from "@bnbagent/sdk";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadEnv(ROOT);

async function main(): Promise<void> {
  const network = (process.env.NETWORK ?? "bsc-testnet") as "bsc-testnet" | "bsc-mainnet";
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY is required in scripts/.env (first run only)");
  const password = process.env.WALLET_PASSWORD;
  if (!password) throw new Error("WALLET_PASSWORD is required in scripts/.env (any string)");
  const name = process.env.AGENT_NAME ?? "crewtopia-dev-crew";
  const teamId = process.env.TEAM_ID ?? name.replace(/^crewtopia-/, "");
  const description =
    process.env.AGENT_DESCRIPTION ??
    "Full product crew for hire: Taylor scopes milestones, Reef builds the dapp, Moss wires the backend. Quotes in U, work secured by ERC-8183 escrow.";
  const baseUrl =
    process.env.A2A_BASE_URL ?? "https://h9907ecjy9.execute-api.ap-southeast-1.amazonaws.com/prod";
  const cardUrl = `${baseUrl}/.well-known/teams/${teamId}/agent-card.json`;

  const wallet = new EVMWalletProvider({ password, privateKey });
  const sdk = await ERC8004Agent.create({ walletProvider: wallet, network });
  console.log(`[register-team] network=${network} wallet=${sdk.walletAddress}`);

  // NOTE: AgentEndpoint.a2a() always appends the generic
  // /.well-known/agent-card.json path, so it cannot address a team-scoped
  // card. Construct the endpoint with the exact card URL instead.
  const agentUri = sdk.generateAgentUri({
    name,
    description,
    endpoints: [new AgentEndpoint({ name: 'A2A', endpoint: cardUrl })],
  });
  const result = await sdk.registerAgent(agentUri);

  console.log(`  tx:       ${result.transactionHash}`);
  console.log(`  agent_id: ${result.agentId}`);
  console.log(`  card:     ${cardUrl}`);

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
