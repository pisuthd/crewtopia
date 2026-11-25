/**
 * 5-a2a-server — minimal A2A front for the team (provider side).
 *
 * Copy-owned from bnbagent-sdk's examples/a2a-agent (hand-rolled node:http,
 * no framework): serves the agent card + two skills over JSON-RPC
 * `message/send`:
 *   negotiate-erc8183-job  — wallet-signed price quote (SDK NegotiationHandler)
 *   erc8183-job-status     — read-only on-chain job lookup
 *
 * This server performs NO delivery — script 7 funds a job against it and
 * script 9 settles. Delivery (the sandbox build + submit) lands later.
 *
 * Run:  npm run test:5   (blocks; leave it running for script 6)
 * Env:  scripts/.env — PRIVATE_KEY, WALLET_PASSWORD, NETWORK,
 *         AGENT_NAME, AGENT_DESCRIPTION, A2A_BASE_URL, ERC8183_SERVICE_PRICE
 */
import { randomUUID } from "node:crypto";
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ERC8183Client, JobStatus, NegotiationHandler } from "@bnbagent/sdk/erc8183";
import { EVMWalletProvider, loadEnv } from "@bnbagent/sdk";
import { RateLimitExceeded, SlidingWindowLimiter } from "@bnbagent/sdk/utils";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadEnv(join(ROOT, ".."));

const NETWORK = (process.env.NETWORK ?? "bsc-testnet") as "bsc-testnet" | "bsc-mainnet";
const AGENT_NAME = process.env.AGENT_NAME ?? "crewtopia-probe-01";
const AGENT_DESCRIPTION =
  process.env.AGENT_DESCRIPTION ?? "Crewtopia registration probe.";
const BASE_URL = (process.env.A2A_BASE_URL ?? "http://localhost:8010").replace(/\/+$/, "");
const SERVICE_PRICE = process.env.ERC8183_SERVICE_PRICE ?? "1000000000000000000";
const PORT = Number(new URL(BASE_URL).port || "8010");

const AGENT_CARD = {
  protocolVersion: "0.3.0",
  name: AGENT_NAME,
  description: AGENT_DESCRIPTION,
  url: `${BASE_URL}/a2a`,
  preferredTransport: "JSONRPC",
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ["application/json"],
  defaultOutputModes: ["application/json"],
  skills: [
    {
      id: "negotiate-erc8183-job",
      name: "Negotiate an ERC-8183 job",
      description:
        "Send {skill, task_description, terms} and receive a wallet-signed quote. Anchor the envelope on-chain via createJob.",
      tags: ["erc8183", "negotiation", "bnb-chain"],
      inputModes: ["application/json"],
      outputModes: ["application/json"],
    },
    {
      id: "erc8183-job-status",
      name: "ERC-8183 job status",
      description: "Send {skill, job_id} for a read-only on-chain job lookup.",
      tags: ["erc8183", "status"],
      inputModes: ["application/json"],
      outputModes: ["application/json"],
    },
  ],
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function agentMessage(data: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: "message",
    role: "agent",
    messageId: randomUUID(),
    parts: [{ kind: "data", data }],
  };
}

function extractDataPart(message: Record<string, unknown>): Record<string, unknown> | null {
  const parts = (message.parts as unknown[]) ?? [];
  for (const part of parts) {
    if (
      typeof part === "object" &&
      part !== null &&
      (part as { kind?: unknown }).kind === "data" &&
      typeof (part as { data?: unknown }).data === "object" &&
      (part as { data?: unknown }).data !== null
    ) {
      return (part as { data: Record<string, unknown> }).data;
    }
  }
  return null;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

async function main(): Promise<void> {
  const password = process.env.WALLET_PASSWORD;
  if (!password) throw new Error("WALLET_PASSWORD is required in scripts/.env");
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY is required in scripts/.env");

  const wallet = new EVMWalletProvider({ password, privateKey });
  const client = await ERC8183Client.create({ walletProvider: wallet, network: NETWORK });
  const negotiationHandler = await NegotiationHandler.fromErc8183Client(client, {
    servicePrice: SERVICE_PRICE,
    walletProvider: wallet,
  });
  const limiter = new SlidingWindowLimiter(120, 60, 10_000);

  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      if (!res.headersSent) sendJson(res, 200, { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = (req.method ?? "GET").toUpperCase();
    if (method === "GET" && url.pathname === "/.well-known/agent-card.json") {
      return sendJson(res, 200, AGENT_CARD);
    }
    if (!(method === "POST" && url.pathname === "/a2a")) {
      return sendJson(res, 404, { error: "Not found" });
    }
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    const rpc = body as Record<string, unknown>;
    const reqId = rpc.id;
    const fail = (code: number, message: string) =>
      sendJson(res, 200, { jsonrpc: "2.0", id: reqId, error: { code, message } });
    if (rpc.jsonrpc !== "2.0" || rpc.method !== "message/send") return fail(-32600, "Invalid Request");
    const data = extractDataPart(((rpc.params as Record<string, unknown>)?.message as Record<string, unknown>) ?? {});
    if (data === null || typeof data.skill !== "string") return fail(-32602, "message must carry a data part with a 'skill' field");

    if (data.skill === "negotiate-erc8183-job") {
      try {
        limiter.check(req.socket.remoteAddress ?? "unknown");
      } catch (error) {
        if (error instanceof RateLimitExceeded) return fail(-32000, "Rate limited, retry later");
        throw error;
      }
      if (typeof data.task_description !== "string" || typeof data.terms !== "object" || data.terms === null) {
        return fail(-32602, "negotiate-erc8183-job requires 'task_description' (string) and 'terms' (object)");
      }
      try {
        const envelope = (
          await negotiationHandler.negotiate({ task_description: data.task_description, terms: data.terms })
        ).toDict() as Record<string, unknown>;
        envelope.provider_address = wallet.address;
        return sendJson(res, 200, { jsonrpc: "2.0", id: reqId, result: agentMessage(envelope) });
      } catch (error) {
        console.error(`negotiation failed: ${error instanceof Error ? error.message : String(error)}`);
        return fail(-32603, "Negotiation failed");
      }
    }

    if (data.skill === "erc8183-job-status") {
      if (typeof data.job_id !== "number" || !Number.isInteger(data.job_id)) {
        return fail(-32602, "erc8183-job-status requires an integer 'job_id'");
      }
      try {
        const job = await client.getJob(BigInt(data.job_id));
        return sendJson(res, 200, {
          jsonrpc: "2.0",
          id: reqId,
          result: agentMessage({
            job_id: Number(job.id),
            client: job.client,
            provider: job.provider,
            status: JobStatus[job.status],
            budget: job.budget.toString(),
            expired_at: job.expiredAt.toString(),
            submitted_at: job.submittedAt.toString(),
            deliverable: job.deliverable,
          }),
        });
      } catch (error) {
        console.error(`job lookup failed: ${error instanceof Error ? error.message : String(error)}`);
        return fail(-32603, `Job ${data.job_id} lookup failed`);
      }
    }

    return fail(-32602, `Unknown skill: ${JSON.stringify(data.skill)}`);
  }

  server.listen(PORT, () => {
    console.info(`[5-a2a-server] ${AGENT_NAME} @ ${wallet.address}`);
    console.info(`  card: ${BASE_URL}/.well-known/agent-card.json`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});

// PS C:\projects\crewtopia\scripts> npm run test:5

// > crewtopia-scripts@0.1.0 test:5
// > tsx 5-a2a-server.ts

// [5-a2a-server] crewtopia-probe-01 @ 0x971F6680a20671458d456656081ea8e32102a64e
//   card: http://localhost:8010/.well-known/agent-card.json
