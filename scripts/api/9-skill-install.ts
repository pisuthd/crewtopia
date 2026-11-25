/**
 * api/9-skill-install — guided skill installer loop: resolve a public skill
 * source → install → list → remove. Read-only except a throwaway install
 * that is removed again, leaving the sandbox clean.
 *
 * Run: npx tsx api/9-skill-install.ts
 * Env: scripts/.env (PRIVATE_KEY + API session via api/1-auth.ts).
 */
import { api, check, finish, requireSession } from "./config.js";

const SOURCE = "Cournot-AI/cournot-skills/skills/cournot";

async function main(): Promise<void> {
  const { token } = requireSession();
  const relay = (body: Record<string, unknown>) =>
    api("/rent/io/skills", token, { method: "POST", body: JSON.stringify(body) });

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

  const before: any = await relay({ op: "list" });
  const hadIt = Array.isArray(before.skills) && before.skills.some((s: any) => /cournot/i.test(s?.name ?? ""));

  const prev: any = await relay({ op: "resolve", source: SOURCE });
  check("source resolves to a preview", !!prev.preview?.name, String(prev.preview?.name ?? prev.error ?? "no preview"));
  if (!prev.preview) throw new Error(`resolve failed: ${prev.error ?? "unknown"}`);

  if (!hadIt) {
    const inst: any = await relay({ op: "install", source: SOURCE });
    check("install returns skill list", Array.isArray(inst.skills), `count=${(inst.skills ?? []).length}`);
  } else {
    console.log("  cournot already installed — skipping install");
  }
  const after: any = await relay({ op: "list" });
  const found = (after.skills ?? []).find((s: any) => /cournot/i.test(s?.name ?? ""));
  check("installed skill listed", !!found, String(found?.name ?? "missing"));

  if (!hadIt && found) {
    await relay({ op: "remove", name: found.name });
    const cleaned: any = await relay({ op: "list" });
    check(
      "registry cleaned",
      !(cleaned.skills ?? []).some((s: any) => /cournot/i.test(s?.name ?? "")),
    );
  }

  finish("9-skill-install");
}

main().catch((e) => {
  console.error("9-skill-install crashed:", e?.message ?? e);
  process.exit(1);
});
