/**
 * e2e/cold-buyer — conformance test: simulates a cold buyer agent that only
 * knows our on-chain record. Steps: discover endpoint (env) → GET card →
 * negotiate unbound → bind with EIP-191 sig → negotiate bound → status check
 * → negative test (bad sig rejected). All assertions must pass.
 *
 * Env (scripts/.env): PRIVATE_KEY (test buyer wallet), A2A_BASE_URL (default:
 * deployed backend-cdk ApiUrl).
 *
 * Run:  npx tsx e2e/cold-buyer.ts
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, http, recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { loadEnv } from "@bnbagent/sdk";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
loadEnv(ROOT);

const BASE =
  process.env.A2A_BASE_URL ?? "https://8lgt6x9mn8.execute-api.ap-southeast-1.amazonaws.com/prod";
const CARD_URL = `${BASE}/.well-known/agent-card.json`;
const SEND_URL = `${BASE}/a2a/message/send`;

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}

async function send(data: Record<string, unknown>) {
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "message/send",
      params: { message: { messageId: crypto.randomUUID(), role: "user", parts: [{ kind: "data", data }] } },
    }),
  });
  return (await res.json()) as any;
}

function taskText(reply: any): string {
  return reply?.result?.status?.message?.parts?.[0]?.text ?? "";
}

function quoteArtifact(reply: any): any {
  return (reply?.result?.artifacts ?? []).find((a: any) => a?.name === "quote")
    ?.parts?.[0]?.data;
}

async function main() {
  const rawKey = process.env.PRIVATE_KEY;
  if (!rawKey) throw new Error("PRIVATE_KEY required in scripts/.env (test buyer wallet)");
  const account = privateKeyToAccount(rawKey as `0x${string}`);
  console.log(`[cold-buyer] buyer=${account.address}`);

  // 1. Discover: GET the card.
  const card = (await (await fetch(CARD_URL)).json()) as any;
  check("card serves", card?.name === "wayfind-dev-team", card?.name);
  const skillIds = (card?.skills ?? []).map((s: any) => s.id);
  check("card advertises negotiate-web3-task", skillIds.includes("negotiate-web3-task"), skillIds.join(","));
  check("card advertises web3-task-status", skillIds.includes("web3-task-status"));

  // 2. Negotiate unbound (browsing).
  // Test brief: landing page for an oracle project (small, realistic).
  const brief = "Landing page for a price oracle project";
  const r1 = await send({ skill: "negotiate-web3-task", brief });
  const t1 = taskText(r1);
  const id1 = /task_id ([0-9a-f-]{36})/.exec(t1)?.[1] ?? "";
  check("unbound negotiate returns task_id", !!id1, id1);
  check("unbound hint mentions binding", t1.includes("To bind: sign"));

  // 3. Bind: sign the canonical message, negotiate again.
  const nonce = `dryrun-${Date.now()}`;
  const message = `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${nonce}`;
  const buyerSig = await createWalletClient({ account, chain: bscTestnet, transport: http() }).signMessage({ message });
  const recovered = await recoverMessageAddress({ message, signature: buyerSig });
  check("sig recovers locally", recovered.toLowerCase() === account.address.toLowerCase());
  const r2 = await send({ skill: "negotiate-web3-task", brief, buyerAddress: account.address, nonce, buyerSig });
  const t2 = taskText(r2);
  const id2 = /task_id ([0-9a-f-]{36})/.exec(t2)?.[1] ?? "";
  check("bound negotiate returns task_id", !!id2, id2);
  check("bound reply confirms buyer", t2.toLowerCase().includes(`buyer bound: ${account.address.toLowerCase()}`), t2.slice(0, 80));
  const quote = quoteArtifact(r2);
  check("quote artifact present", !!quote?.totalU, quote?.totalU ?? "none");
  check(
    "quote total matches text",
    !!quote && (t2.includes(`Total: ${quote.totalU} U`) || t2.includes(`${quote.totalU} U total`)),
    quote ? `${quote.totalU} U, ${quote.chunks} chunk(s) rental` : "no quote",
  );
  check("quote denominated in U escrow terms", quote?.currency === "U" && quote?.escrow?.standard === "ERC-8183");
  check("quote is flat rental", quote?.model === "rental" && quote?.rateUPerHour === "0.01" && quote?.chunkSeconds === 360, quote ? `${quote.model} @ ${quote.rateUPerHour}/hr` : "no quote");

  // 4. Status shows the bound buyer from the ledger (not an echo).
  const r3 = await send({ skill: "web3-task-status", task_id: id2 });
  const t3 = taskText(r3);
  check("status reads buyer from ledger", t3.toLowerCase().includes(`buyer=${account.address.toLowerCase()}`), t3.slice(0, 120));

  // 5. Negative: mismatched sig rejected.
  const r4 = await send({ skill: "negotiate-web3-task", brief, buyerAddress: account.address, nonce: "other", buyerSig });
  check("bad binding rejected", !!r4?.error, r4?.error?.message ?? "accepted?!");

  // 6. Accept the quote → server creates the escrow job (provider = team wallet).
  const acceptNonce = `accept-${Date.now()}`;
  const acceptMsg = `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${acceptNonce}`;
  const acceptSig = await createWalletClient({ account, chain: bscTestnet, transport: http() }).signMessage({
    message: acceptMsg,
  });
  const r5 = await send({ skill: "accept-web3-quote", task_id: id2, buyerAddress: account.address, nonce: acceptNonce, buyerSig: acceptSig });
  if (r5?.error) {
    check("accept creates escrow job", false, r5.error.message);
  } else {
    const escrowData = (r5?.result?.artifacts ?? []).find((a: any) => a?.name === "escrow")?.parts?.[0]?.data;
    const jobId = escrowData?.jobId;
    check("accept returns jobId", !!jobId, jobId ? `job ${jobId}, ${quote?.totalU} U` : taskText(r5).slice(0, 100));

    // 7. Fund on-chain as buyer (same test wallet plays buyer in the dry run),
    // then status must flip to WORKING via lazy fund verification.
    if (jobId) {
      const { ERC8183Client, EVMWalletProvider } = await import("@bnbagent/sdk");
      const buyerWallet = new EVMWalletProvider({ password: process.env.WALLET_PASSWORD!, privateKey: rawKey });
      const buyerClient = await ERC8183Client.create({ walletProvider: buyerWallet, network: "bsc-testnet" });
      await buyerClient.fund(BigInt(jobId), BigInt(quote.totalWei));
      // Fresh VM boot takes minutes — poll until the lazy flip lands.
      let t6 = "";
      for (let i = 0; i < 20; i++) {
        const r6 = await send({ skill: "web3-task-status", task_id: id2 });
        t6 = taskText(r6);
        if (t6.includes("status=working")) break;
        await new Promise((r) => setTimeout(r, 30000));
      }
      check("funded task flips to WORKING", t6.includes("status=working"), t6.slice(0, 140));

      // 8. Deliver: team operator submits (same test wallet plays provider here).
      const signer = createWalletClient({ account, chain: bscTestnet, transport: http() });
      const dNonce = `deliver-${Date.now()}`;
      const providerSig = await signer.signMessage({ message: `Crewtopia deliver v1\ntask: ${id2}\naction: submit\nnonce: ${dNonce}` });
      const r7 = await send({ skill: "web3-deliver", task_id: id2, action: "submit", providerAddress: account.address, nonce: dNonce, providerSig });
      check("submit pins deliverable", !r7?.error && taskText(r7).includes("Delivered."), r7?.error?.message ?? taskText(r7).slice(0, 100));

      // 9. Settle inside the window must wait (chain decides, not us).
      const sNonce = `settle-${Date.now()}`;
      const settleSig = await signer.signMessage({ message: `Crewtopia deliver v1\ntask: ${id2}\naction: settle\nnonce: ${sNonce}` });
      const r8 = await send({ skill: "web3-deliver", task_id: id2, action: "settle", providerAddress: account.address, nonce: sNonce, providerSig: settleSig });
      check("in-window settle waits", !r8?.error && (taskText(r8).includes("Dispute window closes") || taskText(r8).includes("still syncing")), r8?.error?.message ?? taskText(r8).slice(0, 120));

      // 10. Buyer approval is recorded as intent (pre-authorizes, never bypasses).
      const approval = await signer.signMessage({ message: `Crewtopia approve v1\ntask: ${id2}` });
      const sNonce2 = `${sNonce}-approved`;
      const settleSig2 = await signer.signMessage({ message: `Crewtopia deliver v1\ntask: ${id2}\naction: settle\nnonce: ${sNonce2}` });
      const r9 = await send({ skill: "web3-deliver", task_id: id2, action: "settle", providerAddress: account.address, nonce: sNonce2, providerSig: settleSig2, buyerSig: approval });
      check("approval recorded, still waits", !r9?.error && taskText(r9).includes("approval recorded"), r9?.error?.message ?? taskText(r9).slice(0, 120));
      const r10 = await send({ skill: "web3-task-status", task_id: id2 });
      check("status shows submitted + approval", taskText(r10).includes("status=submitted") && taskText(r10).includes("approved=20"), taskText(r10).slice(0, 160));

      // 11. Public receipt resolves (the deliverable URL buyers/judges can open).
      // Post-window completion runs via: TASK_ID=<id> npm run ops:settle
      const receipt = (await (await fetch(`${BASE}/a2a/tasks/${id2}`)).json()) as any;
      check("receipt endpoint serves task", receipt?.taskId === id2 && receipt?.status === "submitted", receipt?.jobId ? `job ${receipt.jobId}` : "no receipt");
      console.log(`\n  post-window: TASK_ID=${id2} npm run ops:settle`);
    }
  }

  if (failures) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nOK — cold-buyer conformance green.");
}

main().catch((e) => {
  console.error(e?.stack ?? e);
  process.exit(1);
});
