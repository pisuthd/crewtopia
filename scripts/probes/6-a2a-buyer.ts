/**
 * 6-a2a-buyer — hire handshake up to the signed quote (chain-free).
 *
 * Mirrors the SDK buyer script's first half: discover the team (ERC-8004
 * registry or direct URL) → fetch the agent card → POST negotiate-erc8183-job
 * → cryptographically verify the quote signature. Stops BEFORE any funding
 * (no keys, no transactions). Script 7 takes the same quote on-chain.
 *
 * Prereq: script 5 running in another terminal (npm run test:5).
 * Run:  npm run test:6
 * Env:  AGENT_ID (optional — resolve A2A endpoint from the on-chain record),
 *         A2A_BASE_URL (default http://localhost:8010),
 *         EXPECTED_PROVIDER_ADDRESS (optional — trust anchor for the quote).
 */
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";
import { ERC8183Client, buildJobDescription, verifyQuoteSignature } from "@bnbagent/sdk/erc8183";
import { ERC8004Agent, EVMWalletProvider, loadEnv } from "@bnbagent/sdk";
import { AgentURIGenerator } from "@bnbagent/sdk/erc8004";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadEnv(join(ROOT, ".."));

const NETWORK = (process.env.NETWORK ?? "bsc-testnet") as "bsc-testnet" | "bsc-mainnet";

async function discoverBaseUrl(): Promise<{ baseUrl: string; trustedProvider?: string }> {
  const agentId = process.env.AGENT_ID;
  if (agentId) {
    const privateKey = process.env.PRIVATE_KEY;
    const password = process.env.WALLET_PASSWORD;
    if (!privateKey || !password) {
      throw new Error("AGENT_ID is set: PRIVATE_KEY + WALLET_PASSWORD required for registry lookup");
    }
    const wallet = new EVMWalletProvider({ password, privateKey });
    const sdk = await ERC8004Agent.create({ walletProvider: wallet, network: NETWORK });
    const info = await sdk.getAgentInfo(Number(agentId));
    const reg = AgentURIGenerator.decodeRegistrationFileFromBase64(String(info.agentURI)) as {
      services?: { name?: string; endpoint?: string }[];
    };
    for (const s of reg.services ?? []) {
      if (s.name === "A2A" && s.endpoint) {
        console.log(`[discover] agent ${agentId} → ${s.endpoint}`);
        return { baseUrl: s.endpoint.replace(/\/+$/, ""), trustedProvider: String(info.agentWallet) };
      }
    }
    console.log(`[discover] agent ${agentId} has no A2A endpoint — falling back to A2A_BASE_URL`);
  }
  return {
    baseUrl: (process.env.A2A_BASE_URL ?? "http://localhost:8010").replace(/\/+$/, ""),
    trustedProvider: process.env.EXPECTED_PROVIDER_ADDRESS,
  };
}

async function resolveMessageUrl(base: string): Promise<string> {
  const cardUrl = `${base}/.well-known/agent-card.json`;
  try {
    const resp = await fetch(cardUrl, { signal: AbortSignal.timeout(10_000) });
    if (resp.ok) {
      const card = (await resp.json()) as { name: string; url: string; skills: { id: string }[] };
      console.log(`[card] ${card.name} — skills: ${card.skills.map((s) => s.id).join(", ")}`);
      return card.url ?? base;
    }
    console.warn(`[discover] card GET → HTTP ${resp.status}; POSTing to base`);
  } catch (error) {
    console.warn(`[discover] card GET failed (${error instanceof Error ? error.message : String(error)})`);
  }
  return base;
}

async function sendSkill(messageUrl: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resp = await fetch(messageUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "message/send",
      params: { message: { kind: "message", role: "user", messageId: randomUUID(), parts: [{ kind: "data", data }] } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const reply = (await resp.json()) as { error?: { message: string }; result?: { parts: { data: Record<string, unknown> }[] } };
  if (reply.error) throw new Error(`A2A error: ${reply.error.message}`);
  return reply.result?.parts[0]?.data ?? {};
}

async function main(): Promise<void> {
  const { baseUrl, trustedProvider } = await discoverBaseUrl();
  const messageUrl = await resolveMessageUrl(baseUrl);

  const quote = await sendSkill(messageUrl, {
    skill: "negotiate-erc8183-job",
    task_description: "Build a landing page preview for a prediction market",
    terms: { deliverables: "One sandbox preview URL", quality_standards: "Loads in a browser" },
  });
  const terms = (quote.response as { terms?: { price?: string; currency?: string } } | undefined)?.terms ?? {};
  console.log(`[quote] price=${terms.price} currency=${terms.currency}`);
  console.log(`[quote] negotiation_hash=${String(quote.negotiation_hash).slice(0, 42)}…`);

  // Cryptographic check only (read-only client — no wallet, no transactions).
  const client = await ERC8183Client.create({ network: NETWORK });
  const provider = getAddress(String(quote.provider_address));
  const verdict = await verifyQuoteSignature({
    envelope: quote,
    provider,
    publicClient: client.publicClient,
    expectedVerifyingContract: client.commerce.address,
  });
  if (!verdict.valid) throw new Error(`Quote rejected: ${verdict.reason}`);
  console.log(`[verify] signature VALID — provider ${provider}`);
  if (trustedProvider) {
    if (getAddress(trustedProvider) !== provider) throw new Error("Quote provider does not match trusted provider");
    console.log("[verify] matches trusted provider");
  } else {
    console.log("[verify] no EXPECTED_PROVIDER_ADDRESS set — trust anchor skipped (fine for local test)");
  }

  // Prove the quote anchors on-chain terms (no write — description only).
  const description = buildJobDescription(quote);
  console.log(`[anchor] job description bytes: ${description.length} chars (same terms createJob would anchor)`);

  console.log("\nOK — handshake complete, nothing funded. Next: 7-happy-path.ts");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
