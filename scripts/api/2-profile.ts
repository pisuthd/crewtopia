/**
 * api/2-profile — read + rename the wallet profile, then restore.
 *
 * Run: npx tsx api/2-profile.ts   (or: npm run api:profile)
 * Needs: scripts/.api-session.json (run 1-auth first).
 */
import { api, check, finish, requireSession } from "./config.js";

async function main() {
  const { token } = requireSession();
  const p0: any = await api("/profile", token);
  const orig = p0.profile?.displayName ?? null;

  const test = `api-test-${Date.now() % 100000}`;
  const r1: any = await api("/profile", token, { method: "PUT", body: JSON.stringify({ displayName: test }) });
  check("rename applies", r1.profile?.displayName === test);
  const g1: any = await api("/profile", token);
  check("rename persists", g1.profile?.displayName === test);

  const back = orig ?? "api-tester";
  const r2: any = await api("/profile", token, { method: "PUT", body: JSON.stringify({ displayName: back }) });
  check("rename restores", r2.profile?.displayName === back);

  try {
    await api("/profile", token, { method: "PUT", body: JSON.stringify({ displayName: "" }) });
    check("empty name rejected", false);
  } catch {
    check("empty name rejected", true);
  }

  finish("2-profile");
}

main().catch((e) => {
  console.error("2-profile crashed:", e?.message ?? e);
  process.exit(1);
});
