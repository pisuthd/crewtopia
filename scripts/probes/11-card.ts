/**
 * 11-card — live agent-card conformance (read-only).
 *
 * Fetches the deployed root + per-team cards and asserts the buyer contract:
 * exactly the three buyer-callable skills (negotiate/accept/status), no
 * operator-only or retired skills, per-team identity matches the pricelist,
 * Studio stays discovery-only, unknown teams 404.
 *
 * No keys, no transactions, no gas. Safe to run in every green check.
 *
 * Run:  npm run test:11
 * Env:  A2A_BASE_URL (default: deployed backend-cdk ApiUrl)
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@bnbagent/sdk";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadEnv(join(ROOT, ".."));

const BASE =
  process.env.A2A_BASE_URL ?? "https://h9907ecjy9.execute-api.ap-southeast-1.amazonaws.com/prod";

const BUYER_SKILLS = ["negotiate-web3-task", "accept-web3-quote", "web3-task-status"];
const RETIRED_SKILLS = ["team-message", "web3-deliver"];

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}

async function getCard(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`);
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function main() {
  console.log(`[11-card] base=${BASE}\n`);

  // 1. Root card = Dev Crew (back-compat primary team).
  const root = await getCard("/.well-known/agent-card.json");
  check("root card serves 200", root.status === 200, String(root.status));
  const card = root.body ?? {};
  check("root card name is crewtopia-dev-crew", card?.name === "crewtopia-dev-crew", card?.name);
  check("root card version is 0.1.0", card?.version === "0.1.0", card?.version);
  const skillIds = (card?.skills ?? []).map((s: any) => s.id);
  for (const id of BUYER_SKILLS) {
    check(`root card advertises ${id}`, skillIds.includes(id), skillIds.join(","));
  }
  for (const id of RETIRED_SKILLS) {
    check(`root card omits retired ${id}`, !skillIds.includes(id), skillIds.join(","));
  }
  check("root card has exactly 3 skills", skillIds.length === 3, skillIds.join(","));
  const team = card?.["x-crewtopia-team"] ?? {};
  check("root card teamId is dev-crew", team?.teamId === "dev-crew", team?.teamId);
  check("root card team status is available", team?.status === "available", team?.status);
  check(
    "root card mentions on-chain disputes",
    String(card?.description ?? "").includes("Disputes go directly on-chain"),
  );

  // 2. Per-team dev card matches root.
  const dev = await getCard("/.well-known/teams/dev-crew/agent-card.json");
  check("dev team card serves 200", dev.status === 200, String(dev.status));
  check("dev team card matches root", dev.body?.name === card?.name, dev.body?.name);
  const devSkills = (dev.body?.skills ?? []).map((s: any) => s.id);
  check("dev team card has exactly 3 skills", devSkills.length === 3, devSkills.join(","));

  // 3. Studio card stays discovery-only.
  const studio = await getCard("/.well-known/teams/studio-crew/agent-card.json");
  check("studio team card serves 200", studio.status === 200, String(studio.status));
  check(
    "studio team card status is soon",
    studio.body?.["x-crewtopia-team"]?.status === "soon",
    studio.body?.["x-crewtopia-team"]?.status,
  );
  check(
    "studio team card has no hire skills",
    ((studio.body?.skills ?? []) as any[]).length === 0,
    JSON.stringify((studio.body?.skills ?? []).map((s: any) => s.id)),
  );

  // 4. Unknown team 404s.
  const unknown = await getCard("/.well-known/teams/nope-crew/agent-card.json");
  check("unknown team card 404s", unknown.status === 404, String(unknown.status));

  if (failures > 0) {
    console.error(`\nFAIL — ${failures} card check(s) failed.`);
    process.exit(1);
  }
  console.log("\nOK — live agent-card contract holds.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
