/**
 * living-brain/1-mcp — prove the computer can host the Living Brain MCP
 * server over the app relay: boot sandbox → relay list → save remote server
 * → restart → assert tools live (real key) or graceful error (dummy key).
 *
 * Run: npx tsx living-brain/1-mcp.ts
 * Env: scripts/.env (PRIVATE_KEY + API session via api/1-auth.ts),
 *   LIVING_BRAIN_API_KEY=lbk_... (real key for the live assertion;
 *   without it the script proves plumbing with a dummy key instead).
 */
import { api, check, finish, requireSession } from "../api/config.js";
import { loadEnv } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

loadEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));

const LB_URL = "https://livingbrain.fernmcp.dev/livingbrain";
const NAME = "living-brain";
const DISABLED = ["brains_remove", "workspace_delete_permanently"];

async function main(): Promise<void> {
  const { token } = requireSession();
  const relay = (body: Record<string, unknown>) =>
    api("/rent/io/mcp", token, { method: "POST", body: JSON.stringify(body) });

  // 1. Sandbox live?
  let st: any = await api("/rent/sandbox/status", token).catch(() => null);
  if (!st?.vmLive) {
    console.log("  sandbox not live — booting…");
    await api("/rent/sandbox/boot", token, { method: "POST", body: "{}" });
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 30_000));
      st = await api("/rent/sandbox/status", token).catch(() => null);
      if (st?.vmLive) break;
    }
  }
  check("sandbox live", !!st?.vmLive, String(st?.state ?? "unknown"));
  if (!st?.vmLive) throw new Error("sandbox did not boot");

  // 2. Registry round-trips through the relay.
  const before: any = await relay({ op: "list" });
  check("relay list works", Array.isArray(before.servers), `servers=${(before.servers ?? []).length}`);

  // 3. Save the Living Brain remote server (real key or dummy for plumbing).
  const realKey = process.env.LIVING_BRAIN_API_KEY ?? "";
  const headers = realKey
    ? { "x-api-key": realKey, "x-subject-id": "3f2b8c1e-7a4d-4e9b-9c2a-5d6e7f8a9b0c" }
    : { "x-api-key": "lbk_dummy_plumbing_only", "x-subject-id": "3f2b8c1e-7a4d-4e9b-9c2a-5d6e7f8a9b0c" };
  let saved: any;
  try {
    saved = await relay({ op: "save", name: NAME, url: LB_URL, headers, disabledTools: DISABLED });
  } catch (e) {
    if (e instanceof Error && /exists|409/.test(e.message)) {
      saved = await relay({ op: "patch", name: NAME, url: LB_URL, headers, disabledTools: DISABLED });
    } else {
      throw e;
    }
  }
  check("server saved", Array.isArray(saved.servers), `servers=${(saved.servers ?? []).length}`);

  // 4. Restart → connect. Real key: tools must go live. Dummy: must fail
  // gracefully (error status, no crash) — plumbing still proven.
  const after: any = await relay({ op: "restart", name: NAME });
  const live = (after.servers ?? []).find((s: any) => s.name === NAME) ?? {};
  console.log(`  server: type=${live.type ?? "?"} status=${live.status ?? "?"} tools=${live.tools ?? "?"}`);
  if (realKey) {
    check("living-brain connected with tools", live.status === "connected" && Number(live.tools) > 0, `tools=${live.tools ?? "?"}`);
  } else {
    check("dummy key fails gracefully (no crash)", live.status !== "connected", `status=${live.status ?? "?"}`);
    console.log("  (set LIVING_BRAIN_API_KEY and re-run for the live-tools assertion)");
  }

  // 5. Cleanup — leave the registry as found.
  await relay({ op: "remove", name: NAME }).catch(() => null);
  const cleaned: any = await relay({ op: "list" }).catch(() => ({ servers: [] }));
  check("registry cleaned", !(cleaned.servers ?? []).some((s: any) => s.name === NAME));

  finish("1-mcp");
}

main().catch((e) => {
  console.error("1-mcp crashed:", e?.message ?? e);
  process.exit(1);
});
