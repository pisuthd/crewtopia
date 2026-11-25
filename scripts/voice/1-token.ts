/**
 * Mint a WebRTC conversation token for a Speech Engine (what the browser
 * Talk button will fetch per session). Pure API — proves the token path
 * without any public server or microphone.
 *
 *   ENGINE_ID=seng_... npx tsx voice/1-token.ts
 *   (or falls back to voice/.last-voice-engine.json from 0-engine KEEP=1)
 */
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { loadEnv } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

loadEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));

const KEY = process.env.ELEVENLABS_API_KEY ?? "";
if (!KEY) throw new Error("ELEVENLABS_API_KEY missing — copy it into scripts/.env");

function resolveEngineId(): string {
  if (process.env.ENGINE_ID) return process.env.ENGINE_ID;
  const f = join(dirname(fileURLToPath(import.meta.url)), ".last-voice-engine.json");
  if (existsSync(f)) {
    const j = JSON.parse(readFileSync(f, "utf8")) as { engineId?: string };
    if (j.engineId) return j.engineId;
  }
  throw new Error("need ENGINE_ID env or run 0-engine with KEEP=1 first");
}

async function main(): Promise<void> {
  const engineId = resolveEngineId();
  const client = new ElevenLabsClient({ apiKey: KEY });
  const out: any = await client.conversationalAi.conversations.getWebrtcToken({ agentId: engineId });
  const token: string = out.token ?? out.conversation_token ?? "";
  if (!token) throw new Error("no token in response: " + JSON.stringify(out).slice(0, 200));
  console.log("engine:", engineId);
  console.log("token: head=", token.slice(0, 12), "... len=", token.length);
  console.log("TOKEN-OK");
}

void main();
