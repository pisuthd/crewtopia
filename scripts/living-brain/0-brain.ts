/**
 * living-brain/0-brain — trial: can Living Brain hold crew memory?
 *
 * Flow: client (test subject) → create brain → capture a fake call
 * transcript as a note + two chat turns (user/agent, agentName=Aria) →
 * poll until pages compile → searchPages recall → index digest size.
 * Verdict criteria: text ingest accepted, compile latency, search hit,
 * index token budget for per-attach injection.
 *
 * Run:  npm run memory:brain
 * Env:  LIVING_BRAIN_API_KEY=lbk_... (dashboard-issued, server-side only),
 *         SUBJECT_ID (default: fixed probe UUID — brains are per-subject)
 */
import { LivingBrainClient } from "@living-brain/sdk";
import { loadEnv } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadEnv(join(ROOT, ".."));

const SUBJECT = process.env.SUBJECT_ID ?? "3f2b8c1e-7a4d-4e9b-9c2a-5d6e7f8a9b0c";

const TRANSCRIPT = [
  "Aria: Hi, thanks for calling Maple & Rye — how can I help?",
  "Caller: Do you cater office lunches for thirty people?",
  "Aria: Yes — our working lunch covers thirty, Finn is checking Friday slots now.",
  "Finn: Friday noon works, deposit is twenty percent to hold it.",
  "Aria: Friday noon is open with a twenty percent deposit. Want me to hold it?",
  "Caller: Yes please, under Priya. And no peanuts anywhere.",
  "Dot: Noted — Priya, thirty covers, Friday noon, nut-free.",
].join("\n");

async function main(): Promise<void> {
  const apiKey = process.env.LIVING_BRAIN_API_KEY;
  if (!apiKey) throw new Error("LIVING_BRAIN_API_KEY is required in scripts/.env");
  const t0 = Date.now();
  const client = new LivingBrainClient({ apiKey, subjectId: SUBJECT });
  console.log(`[0-brain] subject=${SUBJECT}`);

  const brain: any = await client.brains.create({
    name: `crewtopia-probe-${Date.now().toString(36)}`,
    description: "Probe: voice crew call memory (throwaway)",
  });
  const brainId = String(brain?.id ?? brain?.brainId ?? "");
  if (!brainId) throw new Error(`create returned no id: ${JSON.stringify(brain).slice(0, 200)}`);
  console.log(`  brain: ${brainId}`);

  const note: any = await client.captures.capture({
    brainId,
    body: {
      kind: "note",
      content: TRANSCRIPT,
      label: "call 2026-11-24 — Maple & Rye catering",
      originRef: `probe:call:${Date.now()}`,
    },
  });
  console.log(`  note source: ${note?.id ?? "?"} status=${note?.status ?? "?"}`);

  for (const [text, sender] of [
    ["Do you cater office lunches for thirty people?", "user"],
    ["Friday noon is open with a twenty percent deposit.", "agent"],
  ] as const) {
    const turn: any = await client.captures.captureChatTurn({
      brainId,
      text,
      sender,
      agentName: "Aria",
      originRef: `probe:turn:${Date.now()}:${sender}`,
    });
    console.log(`  turn[${sender}]: source=${turn?.id ?? turn?.sourceId ?? "?"}`);
  }

  // Poll until at least one page compiles (async pipeline).
  let pages: any[] = [];
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const res: any = await client.workspace.listPages({ brainId });
    const data = res?.data ?? res?.items ?? res ?? [];
    pages = Array.isArray(data) ? data : [];
    if (pages.length > 0) break;
    await new Promise((r) => setTimeout(r, 20_000));
  }
  const compileMs = Date.now() - t0;
  console.log(`  pages: ${pages.length} (compile wait ${(compileMs / 1000).toFixed(0)}s)`);
  for (const p of pages.slice(0, 5)) {
    console.log(`    - ${p?.title ?? "?"} → ${String(p?.summary ?? "").slice(0, 100)}`);
  }
  if (pages.length === 0) throw new Error("no pages compiled in 10 min — pipeline too slow for crew memory");

  const hits: any = await client.workspace.searchPages({ brainId, query: "nut allergy catering deposit", topK: 3 });
  const list = (hits as any)?.data ?? hits ?? [];
  console.log(`  search hits: ${Array.isArray(list) ? list.length : "?"}`);
  for (const h of (Array.isArray(list) ? list : []).slice(0, 3)) {
    console.log(`    - ${Number(h?.similarity ?? 0).toFixed(2)} [${h?.matchedOn ?? "?"}] ${h?.title ?? "?"}`);
  }
  const found = JSON.stringify(list).toLowerCase().includes("priya");
  console.log(`  recall check (finds 'Priya'): ${found ? "HIT" : "MISS"}`);

  const idx: any = await client.workspace.index({ brainId, limit: 10 });
  const digest = typeof idx === "string" ? idx : JSON.stringify(idx);
  console.log(`  index digest: ${digest.length} chars (~${Math.round(digest.length / 4)} tokens)`);

  console.log(found ? "\nOK — brain holds + recalls crew memory. Next: wire capture/index into backend." : "\nWARN — compiled but recall missed; tune query before wiring backend.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
