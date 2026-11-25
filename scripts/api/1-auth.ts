/**
 * api/1-auth — wallet sign-in: nonce → EIP-191 sign → session JWT.
 * Saves scripts/.api-session.json for scripts 2-5. Run first.
 *
 * Run: npx tsx api/1-auth.ts   (or: npm run api:auth)
 */
import { account, address, api, check, finish, saveSession } from "./config.js";

async function main() {
  // 1. Nonce for our address.
  const n = await api("/auth/nonce", null, { method: "POST", body: JSON.stringify({ address }) });
  check("nonce issued", typeof n.message === "string" && typeof n.nonce === "string");
  check("nonce bound to address", n.address?.toLowerCase() === address.toLowerCase(), String(n.address));

  // 2. Sign the server's message verbatim (exact bytes — any drift fails closed).
  const signature = await account.signMessage({ message: n.message });
  check("message signed", signature.startsWith("0x"));

  // 3. Exchange the signature for a session JWT + profile.
  const v = await api("/auth/verify", null, { method: "POST", body: JSON.stringify({ address, signature }) });
  check("session minted", typeof v.token === "string");
  check(
    "profile bound to address",
    v.profile?.walletAddress?.toLowerCase() === address.toLowerCase(),
    JSON.stringify(v.profile)?.slice(0, 120),
  );
  saveSession(v.token);

  // 4. The token gates /profile (mirrors what the app calls on load).
  const p = await api("/profile", v.token);
  check("profile round-trips on token", p.profile?.walletAddress?.toLowerCase() === address.toLowerCase());

  // 5. A forged token must fail closed.
  try {
    await api("/profile", "bad.token.here");
    check("bad token rejected", false);
  } catch {
    check("bad token rejected", true);
  }

  finish("1-auth");
}

main().catch((e) => {
  console.error("1-auth crashed:", e?.message ?? e);
  process.exit(1);
});
