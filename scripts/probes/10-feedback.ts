/**
 * 10-feedback — record the delivery receipt (STUB).
 *
 * Why a stub: the bnbagent-sdk (v0.6.1) ships NO reputation client and its
 * address book deploys no Reputation Registry — `giveFeedback` exists only
 * in the ERC-8004 spec, not in code we can call. The 8004scan indexer does
 * track total_score/total_feedbacks per agent (see script 4 output), so the
 * reputation story is real; the write path just isn't in the SDK yet.
 *
 * This script prints the exact receipt payload the real call will post
 * (agent, job, score, x402 proof-of-payment tx) and saves it to
 * .last-feedback.json. When the SDK (or a direct contract call) supports
 * giveFeedback, replace the stub block below — the payload shape already
 * matches the spec's off-chain feedback file + proofOfPayment field.
 *
 * Run:  npm run test:10   (reads scripts/.last-job.json from scripts 7/9)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const store = join(ROOT, "..", ".last-job.json");
  if (!existsSync(store)) throw new Error("No .last-job.json — run scripts 7 and 9 first");
  const saved = JSON.parse(readFileSync(store, "utf8")) as {
    jobId: string;
    price: string;
    network: string;
    settleTx?: string;
  };
  if (!saved.settleTx) throw new Error("Job not settled yet — run script 9 first");

  const idsPath = join(ROOT, "..", ".agent-ids.json");
  const ids = existsSync(idsPath) ? (JSON.parse(readFileSync(idsPath, "utf8")) as Record<string, { agentId: number }>) : {};
  const firstTeam = Object.keys(ids)[0];

  const receipt = {
    agentRegistry: `eip155:${saved.network === "bsc-mainnet" ? 56 : 97}:0x8004A818BFB912233c491871b3d84c89A494BD9e`,
    agent: firstTeam ?? "crewtopia-probe-01",
    agentId: firstTeam ? ids[firstTeam].agentId : 2884,
    jobId: saved.jobId,
    network: saved.network,
    value: 100,
    valueDecimals: 0,
    tag1: "completed",
    tag2: "happy-path",
    proofOfPayment: { jobId: saved.jobId, settleTx: saved.settleTx, price: saved.price },
    note: "STUB — no SDK reputation client yet; payload matches ERC-8004 feedback file shape",
  };
  console.log("[10-feedback] receipt that WOULD be posted:");
  console.log(JSON.stringify(receipt, null, 2));
  writeFileSync(join(ROOT, "..", ".last-feedback.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log("\nOK — saved to .last-feedback.json. Wire to giveFeedback when the SDK supports it.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
