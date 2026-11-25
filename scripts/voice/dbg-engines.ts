import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { loadEnv } from "@bnbagent/sdk";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

loadEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));

async function main(): Promise<void> {
  const c = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! });
  const list: any = await c.speechEngine.list();
  for (const e of list?.speechEngines ?? []) {
    const tags: string[] = e.tags ?? [];
    if (!tags.includes("crewtopia")) continue;
    console.log("engine:", e.speechEngineId, "| name:", e.name, "| tags:", JSON.stringify(tags));
    try {
      const full: any = await c.speechEngine.get(e.speechEngineId);
      const cfg = full?.config ?? {};
      console.log("  ws_url:", cfg?.speechEngine?.wsUrl);
      console.log("  headers:", JSON.stringify(cfg?.speechEngine?.requestHeaders ?? {}).slice(0, 80));
      console.log("  auth:", JSON.stringify(cfg?.auth ?? {}));
      console.log("  conv:", JSON.stringify(cfg?.conversation ?? {}).slice(0, 120));
    } catch (err) {
      console.log("  get failed:", err instanceof Error ? err.message : err);
    }
  }
  console.log("ENGINES-OK");
}
void main();
