/**
 * Voice engine lifecycle probe: create \u2192 get \u2192 update \u2192 list \u2192 delete.
 * Pure ElevenLabs API — no public server needed. The ws_url is a placeholder
 * until the VM /voice-chat route lands (Phase 1 rewires it to the sandbox).
 *
 *   npx tsx voice/0-engine.ts            # full cycle with cleanup
 *   KEEP=1 npx tsx voice/0-engine.ts     # keep the engine, save id to .last-voice-engine.json
 */
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { loadEnv } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

loadEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));

const KEY = process.env.ELEVENLABS_API_KEY ?? "";
if (!KEY) throw new Error("ELEVENLABS_API_KEY missing — copy it into scripts/.env");

async function main(): Promise<void> {
  const client = new ElevenLabsClient({ apiKey: KEY });
  const stamp = Date.now().toString(36);
  const name = `crewtopia-voice-probe-${stamp}`;

  // 1. create (placeholder ws_url — never dialed by this script)
  const created: any = await client.speechEngine.create({
    name,
    speechEngine: { wsUrl: "wss://example.invalid/voice-chat" },
    tags: ["probe", "crewtopia"],
    overrides: { firstMessage: true },
    auth: { enableAuth: true },
  } as any);
  const engineId: string = created.engineId ?? created.speech_engine_id;
  if (!engineId) throw new Error("create returned no engine id: " + JSON.stringify(created).slice(0, 200));
  console.log("created:", engineId, "name:", created.name ?? name);

  // 2. get — resource carries full config under .config (lazy object)
  const got: any = await client.speechEngine.get(engineId);
  const cfg: any = got?.config ?? got;
  console.log(
    "get: tts=",
    cfg?.tts?.modelId ?? "?",
    "voice=",
    String(cfg?.tts?.voiceId ?? "?").slice(0, 12),
    "maxDur=",
    cfg?.conversation?.maxDurationSeconds ?? "?",
    "firstMsgOverride=",
    cfg?.overrides?.firstMessage ?? "?",
    "auth=",
    cfg?.auth?.enableAuth ?? "?",
    "ws=",
    cfg?.speechEngine?.wsUrl ?? "?",
  );

  // 3. update — tags round-trip
  const updated: any = await client.speechEngine.update(engineId, { tags: ["probe", "crewtopia", "verified"] } as any);
  const ucfg: any = updated?.config ?? updated;
  console.log("updated: tags=", JSON.stringify(ucfg?.tags ?? ucfg?.conversation ?? "").slice(0, 80));

  // 4. list — summaries key the id as speechEngineId
  const listed: any = await client.speechEngine.list();
  const items: any[] = Array.isArray(listed) ? listed : (listed?.speechEngines ?? []);
  const mine = items.find((e: any) => (e.speechEngineId ?? e.engineId) === engineId);
  console.log("list: total=", items.length, "found-ours=", !!mine);

  // 5. cleanup (or keep)
  if (process.env.KEEP === "1") {
    writeFileSync(
      join(dirname(fileURLToPath(import.meta.url)), ".last-voice-engine.json"),
      JSON.stringify({ engineId, name, at: new Date().toISOString() }) + "\n",
    );
    console.log("kept (KEEP=1), id saved to voice/.last-voice-engine.json");
  } else {
    await client.speechEngine.delete(engineId);
    console.log("deleted (probe cleanup)");
  }
  console.log("ENGINE-OK", engineId);
}

void main();
