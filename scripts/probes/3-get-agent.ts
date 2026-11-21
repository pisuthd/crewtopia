/**
 * 3-get-agent — read back an on-chain agent record.
 *
 * Verifies script 2 actually landed: resolves the ERC-8004 identity,
 * prints the registration file (decoded), agent wallet and endpoints.
 * Read-only: sends no transactions (a key is still required to construct
 * the lookup client — same scripts/.env as script 2).
 *
 * Run:  npm run test:3
 * Env:  AGENT_ID=<id>  — or defaults to AGENT_NAME / first entry in .agent-ids.json
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ERC8004Agent, EVMWalletProvider, loadEnv } from "@bnbagent/sdk";
import { AgentURIGenerator } from "@bnbagent/sdk/erc8004";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadEnv(join(ROOT, ".."));

function resolveAgentId(): number {
  if (process.env.AGENT_ID) return Number(process.env.AGENT_ID);
  const idsPath = join(ROOT, "..", ".agent-ids.json");
  if (!existsSync(idsPath)) {
    throw new Error("No AGENT_ID env and no .agent-ids.json — run script 2 first");
  }
  const ids = JSON.parse(readFileSync(idsPath, "utf8")) as Record<
    string,
    { agentId: number }
  >;
  const name = process.env.AGENT_NAME ?? Object.keys(ids)[0];
  if (!name || !ids[name]) throw new Error(`No entry for ${name ?? "(none)"} in .agent-ids.json`);
  return Number(ids[name].agentId);
}

async function main(): Promise<void> {
  const network = (process.env.NETWORK ?? "bsc-testnet") as "bsc-testnet" | "bsc-mainnet";
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY is required in scripts/.env");
  const password = process.env.WALLET_PASSWORD;
  if (!password) throw new Error("WALLET_PASSWORD is required in scripts/.env");

  const agentId = resolveAgentId();
  const wallet = new EVMWalletProvider({ password, privateKey });
  const sdk = await ERC8004Agent.create({ walletProvider: wallet, network });
  console.log(`[3-get-agent] network=${network} agent_id=${agentId}\n`);

  const info = await sdk.getAgentInfo(agentId);
  console.log("on-chain record:");
  for (const [k, v] of Object.entries(info)) {
    const shown = typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : v;
    console.log(`  ${k.padEnd(14)} ${String(shown)}`);
  }

  const uri = String((info as { agentURI?: unknown }).agentURI ?? "");
  if (uri.startsWith("data:")) {
    const reg = AgentURIGenerator.decodeRegistrationFileFromBase64(uri) as {
      name?: unknown;
      description?: unknown;
      services?: { name?: unknown; endpoint?: unknown }[];
    };
    console.log("\nregistration file:");
    console.log(`  name         ${String(reg.name)}`);
    console.log(`  description  ${String(reg.description)}`);
    for (const s of reg.services ?? []) {
      console.log(`  endpoint     [${String(s.name)}] ${String(s.endpoint)}`);
    }
  } else {
    console.log(`\nagentURI (non-data, fetch directly): ${uri}`);
  }
  console.log("\nOK — record resolves. Next: 4-list-agents.ts");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});


// PS C:\projects\crewtopia\scripts> npm run test:3

// > crewtopia-scripts@0.1.0 test:3
// > tsx 3-get-agent.ts

// [3-get-agent] network=bsc-testnet agent_id=2884

// on-chain record:
//   agentId        2884
//   agentAddress   0x971F6680a20671458d456656081ea8e32102a64e
//   agentWallet    0x971F6680a20671458d456656081ea8e32102a64e
//   owner          0x971F6680a20671458d456656081ea8e32102a64e
//   agentURI       data:application/json;base64,eyJkZXNjcmlwdGlvbiI6IlN3YXJtbHkgcmVnaXN0cmF0aW9uIHByb2JlOiB0aHJvd2F3YXkgdGVzdCBpZGVudGl0eSw…

// registration file:
//   name         crewtopia-probe-01
//   description  Crewtopia registration probe: throwaway test identity, not a real team.
//   endpoint     [web] https://crewtopia.xyz

// OK — record resolves. Next: 4-list-agents.ts