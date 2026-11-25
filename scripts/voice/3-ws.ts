/**
 * Voice WS reachability probe: raw WebSocket dial at the sandbox
 * /voice-chat route using the session-minted terminal endpoint. There is no
 * valid ElevenLabs session here, so a CORRECT result is rejection (no 101,
 * connection closed/refused) — proving the route is live on the public
 * endpoint AND locked down (SDK JWT verification), without a browser call.
 *
 * Needs a sandbox booted from an image WITH the voice route (Phase 1+).
 * Run:  npx tsx voice/3-ws.ts
 */
import { loadEnv } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

loadEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));

const API = (process.env.API_BASE_URL ?? "").replace(/\/+$/, "");
const sessionFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".api-session.json");

async function authed(path: string, init?: RequestInit): Promise<any> {
  const { token } = JSON.parse(readFileSync(sessionFile, "utf8")) as { token: string };
  const res = await fetch(`${API}${path}`, {
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
  return body as any;
}

async function main(): Promise<void> {
  // 1. backend voice route first (proves deploy + sandbox live)
  const vs: any = await authed("/rent/io/voice/status");
  console.log("voice-status: attached=", vs.attached, "engine=", vs.engineId ?? "none", "sandboxLive=", vs.sandboxLive, "route=", vs.route);
  if (!vs.sandboxLive) throw new Error("no live sandbox — boot one first");
  if (!vs.route) throw new Error("VM image predates /voice-chat — rebuild the image first");

  // 2. raw WS dial at the public endpoint (no ElevenLabs JWT → must NOT upgrade)
  const tok: any = await authed("/rent/sandbox/token", { method: "POST" });
  const endpoint: string = tok.endpoint;
  if (!endpoint) throw new Error("no sandbox endpoint");
  const url = `wss://${endpoint}/voice-chat`;
  console.log("dialing:", url.replace(/^(wss:\/\/[^/]+).*/, "$1/voice-chat"));
  const outcome: string = await new Promise((resolve) => {
    let settled = false;
    const done = (s: string) => {
      if (!settled) {
        settled = true;
        resolve(s);
      }
    };
    try {
      const socket = new WebSocket(url, ["x-aws-proxy-auth.invalid"]);
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch { /* already gone */ }
        done("timeout-no-upgrade (route live, handshake not completed)");
      }, 15000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        try {
          socket.close();
        } catch { /* ignore */ }
        done("UPGRADED-UNEXPECTED");
      });
      socket.addEventListener("close", () => {
        clearTimeout(timer);
        done("closed-before-open (locked down)");
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        done("refused (locked down)");
      });
    } catch (e) {
      done(`dial-failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  console.log("ws:", outcome);
  if (outcome === "UPGRADED-UNEXPECTED") throw new Error("route accepted an unauthenticated upgrade — NOT locked down");
  console.log("WS-REACH-OK");
}

void main();
