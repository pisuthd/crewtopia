/**
 * Idle VM lifespan watch: boots a RAW microVM on the golden image (no crew,
 * no workload) and polls its platform state. If it dies in minutes with no
 * load, the image/platform is at fault — not our code (CloudTrail already
 * shows no TerminateMicrovm calls from us).
 *
 * Run: npx tsx scripts/a2a/3-idle-watch.ts   (WATCH_MIN env, default 30)
 * Needs: computer/scripts/image/.env (AWS creds/roles for RunMicrovm).
 */
import {
  GetMicrovmCommand,
  RunMicrovmCommand,
  TerminateMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import { EGRESS_INTERNET, INGRESS_ALL, IMAGE_NAME, REGION, mv } from "../../computer/scripts/image/config.js";

const WATCH_MIN = Number(process.env.WATCH_MIN ?? 30);

async function main(): Promise<void> {
  const accountId = process.env.MICROVM_BUILD_ROLE_ARN?.split(":")[4];
  if (!accountId) throw new Error("MICROVM_BUILD_ROLE_ARN required in computer/scripts/image/.env");
  const imageArn = `arn:aws:lambda:${REGION}:${accountId}:microvm-image:${IMAGE_NAME}`;
  const run = await mv.send(
    new RunMicrovmCommand({
      imageIdentifier: imageArn,
      runHookPayload: JSON.stringify({ ownerId: "idle-watch", computerId: `idle-${Date.now().toString(36)}` }),
      ingressNetworkConnectors: [INGRESS_ALL],
      egressNetworkConnectors: [EGRESS_INTERNET],
      maximumDurationInSeconds: 14_400,
    }),
  );
  const vmId = run.microvmId;
  if (!vmId) throw new Error("run-microvm returned no microvmId");
  console.log(`idle VM ${vmId} booting — watching ${WATCH_MIN} min (Ctrl-C keeps it running; it self-caps at 4h)`);
  const t0 = Date.now();
  let last = "";
  try {
    for (;;) {
      const r = await mv.send(new GetMicrovmCommand({ microvmIdentifier: vmId }));
      const mins = Math.round((Date.now() - t0) / 60000);
      if (r.state !== last) {
        console.log(`[+${mins}m] state=${r.state} reason=${(r as any).stateReason ?? "-"}`);
        last = r.state as string;
      }
      if (r.state === "TERMINATED" || Date.now() - t0 > WATCH_MIN * 60_000) break;
      await new Promise((res) => setTimeout(res, 60_000));
    }
  } finally {
    const end = await mv.send(new GetMicrovmCommand({ microvmIdentifier: vmId })).catch(() => null);
    if (end && end.state !== "TERMINATED") {
      await mv.send(new TerminateMicrovmCommand({ microvmIdentifier: vmId })).catch(() => null);
      console.log("watch over — test VM terminated");
    } else {
      console.log(`watch over — VM already ${end?.state ?? "unknown"}`);
    }
  }
}

void main();
