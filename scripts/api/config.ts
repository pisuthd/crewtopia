/**
 * api/config — shared setup for scripts/api/*. All API scripts import from here.
 *
 * Env (scripts/.env): API_BASE_URL (preferred) or A2A_BASE_URL (same gateway),
 *   PRIVATE_KEY (operator key, reused as the test user unless TEST_USER_KEY set).
 * Session: api/1-auth.ts writes scripts/.api-session.json (gitignored);
 *   the rest start with requireSession() and fail fast when it's missing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv } from "@bnbagent/sdk";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
loadEnv(ROOT);

export const BASE = (
  process.env.API_BASE_URL ??
  process.env.A2A_BASE_URL ??
  "http://localhost:3000"
).replace(/\/+$/, "");

const rawKey = (process.env.TEST_USER_KEY ?? process.env.PRIVATE_KEY ?? "") as `0x${string}`;
if (!rawKey) throw new Error("PRIVATE_KEY (or TEST_USER_KEY) required in scripts/.env");

export const account = privateKeyToAccount(rawKey);
export const address = account.address;

const SESSION_FILE = join(ROOT, ".api-session.json");

/** JSON fetch against the API; throws on non-2xx with the server's message. */
export async function api(path: string, token?: string | null, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
  return body;
}

export function saveSession(token: string): void {
  writeFileSync(SESSION_FILE, JSON.stringify({ token, address }, null, 2) + "\n");
}

export function requireSession(): { token: string; address: string } {
  if (!existsSync(SESSION_FILE)) {
    console.error("no API session — run first: npx tsx api/1-auth.ts");
    process.exit(2);
  }
  const saved = JSON.parse(readFileSync(SESSION_FILE, "utf8")) as { token?: string; address?: string };
  if (!saved.token || saved.address?.toLowerCase() !== address.toLowerCase()) {
    console.error("session belongs to another key — re-run: npx tsx api/1-auth.ts");
    process.exit(2);
  }
  return { token: saved.token, address: saved.address };
}

let failures = 0;

export function check(name: string, cond: unknown, extra = ""): void {
  if (cond) {
    console.log(`  ok — ${name}`);
  } else {
    failures++;
    console.log(`  FAIL — ${name}${extra ? ` (${extra})` : ""}`);
  }
}

export function finish(label: string): void {
  if (failures > 0) {
    console.log(`\n${label}: ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\n${label} GREEN`);
}
