/**
 * Hands-off lifespan watch: polls GetMicrovm directly every 30s.
 * Zero app-API calls, zero VM HTTP — pure platform observation.
 * Run: VMID=<microvm-id> npx tsx scripts/a2a/8-lifespan-watch.ts [minutes]
 */
import { GetMicrovmCommand } from "@aws-sdk/client-lambda-microvms";
import { mv } from "../../computer/scripts/image/config.js";

const vmId = process.env.VMID ?? "";
const mins = Number(process.argv[2] ?? process.env.WATCH_MIN ?? 20);
if (!vmId) throw new Error("need VMID env");

async function main(): Promise<void> {
  console.log(`watching ${vmId} for up to ${mins}m (no touching)`);
  const t0 = Date.now();
  for (;;) {
    const r: any = await mv.send(new GetMicrovmCommand({ microvmIdentifier: vmId })).catch((e: Error) => ({ state: `PROBE-FAILED: ${e.message.slice(0, 80)}` }));
    const minsIn = Math.round((Date.now() - t0) / 60000);
    console.log(`[+${minsIn}m] state=${r.state} endpoint=${r.endpoint ? "set" : "none"}`);
    if (r.state === "TERMINATED" || Date.now() - t0 > mins * 60_000) break;
    await new Promise((res) => setTimeout(res, 30_000));
  }
  console.log("watch done");
}

void main();
