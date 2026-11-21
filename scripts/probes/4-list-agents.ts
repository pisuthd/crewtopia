/**
 * 4-list-agents — enumerate registered agents via the 8004scan indexer.
 *
 * Off-chain read (no transactions): lists recent registrations on the
 * network and checks whether our probe (#2884) is indexed yet.
 * (Client construction still needs the scripts/.env key, like script 3.)
 *
 * Run:  npm run test:4
 * Env:  NETWORK (default bsc-testnet), LIMIT (default 20), OFFSET (default 0)
 */
import { ERC8004Agent, EVMWalletProvider, loadEnv } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadEnv(join(ROOT, ".."));

function pickList(obj: Record<string, unknown>): Record<string, unknown>[] {
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.every((e) => typeof e === "object" && e !== null)) {
      return v as Record<string, unknown>[];
    }
  }
  return [];
}

async function main(): Promise<void> {
  const network = (process.env.NETWORK ?? "bsc-testnet") as "bsc-testnet" | "bsc-mainnet";
  const limit = Number(process.env.LIMIT ?? 20);
  const offset = Number(process.env.OFFSET ?? 0);
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY is required in scripts/.env");
  const password = process.env.WALLET_PASSWORD;
  if (!password) throw new Error("WALLET_PASSWORD is required in scripts/.env");

  const wallet = new EVMWalletProvider({ password, privateKey });
  const sdk = await ERC8004Agent.create({ walletProvider: wallet, network });
  console.log(`[4-list-agents] network=${network} limit=${limit} offset=${offset}\n`);

  const res = await sdk.getAllAgents(limit, offset);
  const list = pickList(res);
  console.log(`indexed agents returned: ${list.length}`);
  for (const a of list.slice(0, 10)) {
    const id = String(a.token_id ?? "?");
    const name = String(a.name ?? "");
    const owner = String(a.owner_address ?? "");
    const protocols = Array.isArray(a.supported_protocols) ? a.supported_protocols.join(",") : "";
    console.log(`  #${id.padEnd(8)} ${name.padEnd(28)} ${owner} [${protocols}]`);
  }
  if (list.length > 10) console.log(`  … and ${list.length - 10} more`);

  const ids = new Set(list.map((a) => String(a.token_id ?? "")));
  console.log(`\nprobe #2884 indexed: ${ids.has("2884") ? "YES" : "not in this page (raise LIMIT/OFFSET or wait for indexer)"}`);
  console.log("\nOK — directory listing works. Next: 5-a2a-server.ts");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});


// PS C:\projects\crewtopia\scripts> npm run test:4

// > crewtopia-scripts@0.1.0 test:4
// > tsx 4-list-agents.ts

// [4-list-agents] network=bsc-testnet limit=20 offset=0

// indexed agents returned: 20
//   #2884     crewtopia-probe-01             0x971f6680a20671458d456656081ea8e32102a64e [Web]
//   #2883     studio-agent                 0x7fd05db913c04aff68e26ebb8bfeef5d18b5154c [A2A]
//   #2882     studio-agent                 0x02ba0922a45d8e0b3b9560a8a399672b25a9e6e7 [A2A]
//   #2881     studio-agent                 0x4f81ac2f2bac177559ff38b6076d5b51f17e785c [A2A]
//   #2880     yinko                        0x9444a989db863d256de4f5395f9b10cbe425ad1d [Web]
//   #2879     monitorrose                  0xcb0f6e15606d0ea278e5eadbfd72b8b22a812570 [A2A]
//   #2878     Altana Agent                 0xde46cab7bfaed671e16b8bcd7546f46cfc919059 [Web]
//   #2877     Agent #2877                  0x8c2b6fc38427f3e676ecc7f62e383a09dbb0abcb []
//   #2876     i43165cal3                   0xb278c97df48d985b2f6cc893eabe732ae903db87 [A2A,Web]
//   #2875     i43165cal2                   0x5a8c51a109b3362fd2722dfabda5e47d59d71564 [A2A,Web]
//   … and 10 more

// probe #2884 indexed: YES