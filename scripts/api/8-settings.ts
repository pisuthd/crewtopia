/**
 * api/8-settings — settings relays: skills + permissions + mcp list shapes.
 * Proves the Settings modal's three tabs have live backends: boot sandbox,
 * list each registry via relay, assert array shapes. Read-only (no writes).
 *
 * Run: npx tsx api/8-settings.ts
 * Needs: scripts/.env (PRIVATE_KEY + API session via api/1-auth.ts).
 */
import { api, check, finish, requireSession } from "./config.js";

async function main(): Promise<void> {
  const { token } = requireSession();
  const relay = (path: string, body: Record<string, unknown>) =>
    api(path, token, { method: "POST", body: JSON.stringify(body) });

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

  const skills: any = await relay("/rent/io/skills", { op: "list" });
  check("skills list is array", Array.isArray(skills.skills), `count=${(skills.skills ?? []).length}`);

  const perms: any = await relay("/rent/io/permissions", { op: "get" });
  check("permissions have rules array", Array.isArray(perms.rules), `count=${(perms.rules ?? []).length}`);
  const shapes = (perms.rules ?? []).every(
    (r: any) => typeof r === "object" && typeof r.action === "string",
  );
  check("permission rules shaped {…, action}", shapes);

  const mcp: any = await relay("/rent/io/mcp", { op: "list" });
  check("mcp list is array", Array.isArray(mcp.servers), `count=${(mcp.servers ?? []).length}`);

  finish("8-settings");
}

main().catch((e) => {
  console.error("8-settings crashed:", e?.message ?? e);
  process.exit(1);
});
