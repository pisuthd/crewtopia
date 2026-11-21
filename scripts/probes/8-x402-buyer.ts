/**
 * 8-x402-buyer — metered preview, paid per request (fully offline).
 *
 * Ports the SDK's x402 buyer demo to Crewtopia's story: a sandbox preview
 * endpoint that answers 402 with an EIP-3009 challenge on test U, the buyer
 * signs via the policy-gated X402Signer, retries with X-PAYMENT, and a
 * SessionBudgetTracker caps per-session spend. Nothing touches the chain —
 * the mock seller doesn't verify (a facilitator would in production).
 *
 * Run:  npm run test:8
 * Proves: the exact bytes our future /preview paywall + buyer will exchange.
 */
import { randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { generatePrivateKey } from "viem/accounts";
import { BSC_TESTNET_CHAIN_ID } from "@bnbagent/sdk/networks";
import { EVMWalletProvider } from "@bnbagent/sdk";
import { SessionBudgetTracker, X402Signer, resolveExpectedEip3009Route } from "@bnbagent/sdk/x402";

const DEMO_PK = generatePrivateKey(); // ephemeral, in-memory, never broadcast
const DEMO_PW = "x402-buyer-demo-pw";

// NOTE: the catalog's TEST_U route asset (0x3309…) differs from the escrow
// payment token (0xc70B…). This mock seller only checks the envelope shape,
// like the SDK demo — a production paywall must verify against the real asset.
const U_TESTNET_ROUTE = resolveExpectedEip3009Route("eip155:97", "TEST_U");
const U_TESTNET = U_TESTNET_ROUTE.address;
const NETWORK_ID = `eip155:${BSC_TESTNET_CHAIN_ID}`;
const PAY_TO = `0x${"be".repeat(20)}`; // mock preview-service beneficiary
const PRICE_BASE_UNITS = 100_000n; // preview price, base units
const SECRET_PAYLOAD = "preview-url://sandbox/job-1741";

const EIP712_DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];
const TWA_FIELDS = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
];

function make402Body(): unknown {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: NETWORK_ID,
        asset: U_TESTNET,
        payTo: PAY_TO,
        amount: PRICE_BASE_UNITS.toString(),
        maxTimeoutSeconds: 300,
        extra: { name: U_TESTNET_ROUTE.name, version: U_TESTNET_ROUTE.version },
      },
    ],
    resource: "/preview",
  };
}

function requestHandler(req: IncomingMessage, res: ServerResponse): void {
  if (req.url !== "/preview") {
    res.writeHead(404);
    res.end();
    return;
  }
  if (!req.headers["x-payment"]) {
    const body = JSON.stringify(make402Body());
    res.writeHead(402, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  const body = JSON.stringify({ data: SECRET_PAYLOAD });
  res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

async function main(): Promise<number> {
  console.log("[8-x402-buyer] metered preview — off-chain round-trip");
  console.log(`  network=${NETWORK_ID} U=${U_TESTNET}`);

  const server = createServer(requestHandler);
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const wallet = new EVMWalletProvider({ password: DEMO_PW, privateKey: DEMO_PK, persist: false });
    const signer = new X402Signer(wallet, { maxValuePerCall: { [U_TESTNET]: PRICE_BASE_UNITS } });
    const budget = new SessionBudgetTracker({ [U_TESTNET]: PRICE_BASE_UNITS * 10n });
    console.log(`  buyer wallet: ${wallet.address} (in-memory, session cap ${PRICE_BASE_UNITS * 10n} base units)`);

    const url = `${baseUrl}/preview`;
    let res = await fetch(url);
    if (res.status !== 402) {
      console.error(`expected 402, got ${res.status}`);
      return 1;
    }
    const challenge = (await res.json()) as { accepts: Record<string, unknown>[] };
    const accept = challenge.accepts[0] as {
      scheme: string; network: string; asset: string; payTo: string;
      amount: string; maxTimeoutSeconds: number; extra: { name: string; version: string };
    };
    console.log(`  step 1: GET -> 402 (preview costs ${accept.amount} base units of U)`);

    budget.reserve(U_TESTNET, PRICE_BASE_UNITS);
    const now = Math.floor(Date.now() / 1000);
    const message = {
      from: wallet.address,
      to: accept.payTo,
      value: BigInt(accept.amount),
      validAfter: now - 60,
      validBefore: now + accept.maxTimeoutSeconds,
      nonce: `0x${randomBytes(32).toString("hex")}`,
    };
    const signed = await signer.signPayment({
      domain: { name: accept.extra.name, version: accept.extra.version, chainId: BSC_TESTNET_CHAIN_ID, verifyingContract: accept.asset },
      types: { EIP712Domain: EIP712_DOMAIN_FIELDS, TransferWithAuthorization: TWA_FIELDS },
      message,
      expectedRoute: U_TESTNET_ROUTE,
      expectedTo: PAY_TO,
    });
    console.log(`  step 2: signed EIP-3009 authorization (sig=${signed.signature.slice(0, 10)}...)`);

    const envelope = Buffer.from(
      JSON.stringify({
        x402Version: 2, scheme: accept.scheme, network: accept.network,
        payload: {
          authorization: {
            from: message.from, to: message.to, value: String(message.value),
            validAfter: String(message.validAfter), validBefore: String(message.validBefore), nonce: message.nonce,
          },
          signature: signed.signature,
        },
      }),
    ).toString("base64");

    res = await fetch(url, { headers: { "X-PAYMENT": envelope } });
    const body = (await res.json()) as { data?: unknown };
    if (res.status !== 200 || body.data !== SECRET_PAYLOAD) {
      budget.rollback(U_TESTNET, PRICE_BASE_UNITS);
      console.error(`expected 200 + payload, got ${res.status} ${JSON.stringify(body)}`);
      return 1;
    }
    console.log(`  step 3: retry with X-PAYMENT -> 200, preview unlocked`);
    console.log(`  session spent: ${budget.spent(U_TESTNET)} / cap ${budget.capFor(U_TESTNET)} base units`);

    console.log("\nOK — metering loop works. Next: npm run test:9 (settle job 1741)");
    return 0;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });

// PS C:\projects\crewtopia\scripts> npm run test:8

// > crewtopia-scripts@0.1.0 test:8
// > tsx 8-x402-buyer.ts

// [8-x402-buyer] metered preview — off-chain round-trip
//   network=eip155:97 U=0x330949Aed7d00FCe0558C64ED6FeC9792616cC39
//   buyer wallet: 0x91e5Fa535bfb9a33579A22bC34F1Cbe804919d6a (in-memory, session cap 1000000 base units)
//   step 1: GET -> 402 (preview costs 100000 base units of U)
//   step 2: signed EIP-3009 authorization (sig=0x873a3771...)
//   step 3: retry with X-PAYMENT -> 200, preview unlocked
//   session spent: 100000 / cap 1000000 base units

// OK — metering loop works. Next: npm run test:9 (settle job 1741)