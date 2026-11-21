/**
 * ops/provision-spike — prove WE can boot wayfind's microVM image and reach
 * its server. Disposable VM: boot → /ready → /hooks/run (no secrets) →
 * observe keyless 503 → terminate + verify. Prints shapes, asserts nothing
 * beyond reachability. Local AWS creds required (same profile as cdk).
 *
 * Run:  npm run ops:spike
 */
import {
  CreateMicrovmAuthTokenCommand,
  GetMicrovmCommand,
  LambdaMicrovmsClient,
  RunMicrovmCommand,
  TerminateMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";

const REGION = "ap-southeast-1";
const IMAGE = "arn:aws:lambda:ap-southeast-1:057386374967:microvm-image:wayfind-computer";
const CONN = (name: string) => `arn:aws:lambda:${REGION}:aws:network-connector:aws-network-connector:${name}`;

const vm = new LambdaMicrovmsClient({ region: REGION });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("[spike] run...");
  const run = await vm.send(
    new RunMicrovmCommand({
      imageIdentifier: IMAGE,
      runHookPayload: JSON.stringify({ ownerId: "crewtopia-spike", computerId: "spike-01" }),
      ingressNetworkConnectors: [CONN("ALL_INGRESS")],
      egressNetworkConnectors: [CONN("INTERNET_EGRESS")],
      idlePolicy: { autoResumeEnabled: false, maxIdleDurationSeconds: 900, suspendedDurationSeconds: 604800, maximumDurationInSeconds: 3600 },
      maximumDurationInSeconds: 3600,
    }),
  );
  console.log("[spike] run out:", JSON.stringify(run, null, 2).slice(0, 800));
  const id = (run as any).microvmIdentifier ?? (run as any).microvmId ?? (run as any).microvmArn;
  if (!id) throw new Error("no microvm identifier in Run output");

  let endpoint = "";
  for (let i = 0; i < 40; i++) {
    const got: any = await vm.send(new GetMicrovmCommand({ microvmIdentifier: id }));
    const state = got.state ?? got.microvm?.state ?? JSON.stringify(got).slice(0, 200);
    endpoint = got.endpoint ?? got.microvm?.endpoint ?? "";
    console.log(`[spike] poll ${i}: state=${typeof state === "string" ? state : JSON.stringify(state).slice(0, 160)} endpoint=${endpoint ? "yes" : "no"}`);
    if (endpoint && /running/i.test(JSON.stringify(state))) break;
    await sleep(15000);
  }
  if (!endpoint) throw new Error("VM never reached RUNNING with endpoint — terminating");

  try {
    const tok: any = await vm.send(new CreateMicrovmAuthTokenCommand({ microvmIdentifier: id, allowedPorts: [{ port: 8080 }], expirationInMinutes: 30 }));
    const token = tok?.authToken?.["X-aws-proxy-auth"] ?? tok?.token?.["X-aws-proxy-auth"] ?? "";
    console.log("[spike] token:", token ? "minted" : `UNEXPECTED SHAPE: ${JSON.stringify(tok).slice(0, 300)}`);
    const H = { "X-aws-proxy-auth": token };

    const ready = await fetch(`https://${endpoint}/ready`, { headers: H });
    console.log(`[spike] GET /ready → ${ready.status}: ${(await ready.text()).slice(0, 300)}`);

    const hook = await fetch(`https://${endpoint}/hooks/run`, {
      method: "POST",
      headers: { ...H, "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "crewtopia-spike", computerId: "spike-01", secrets: {}, usageToken: "spike", apiUrl: "https://example.com", workspace: null }),
    });
    console.log(`[spike] POST /hooks/run → ${hook.status}: ${(await hook.text()).slice(0, 300)}`);

    const task = await fetch(`https://${endpoint}/task`, {
      method: "POST",
      headers: { ...H, "content-type": "application/json" },
      body: JSON.stringify({ text: "reply with the word HELLO", ownerId: "crewtopia-spike" }),
    });
    console.log(`[spike] POST /task → ${task.status}: ${(await task.text()).slice(0, 300)}`);
  } finally {
    console.log("[spike] terminating...");
    await vm.send(new TerminateMicrovmCommand({ microvmIdentifier: id }));
    for (let i = 0; i < 12; i++) {
      await sleep(5000);
      try {
        const got: any = await vm.send(new GetMicrovmCommand({ microvmIdentifier: id }));
        console.log(`[spike] terminate poll ${i}: ${JSON.stringify(got.state ?? got).slice(0, 120)}`);
        if (/terminated/i.test(JSON.stringify(got))) break;
      } catch {
        console.log(`[spike] terminate poll ${i}: VM gone (treated as TERMINATED)`);
        break;
      }
    }
  }
  console.log("\nOK — spike complete.");
}

main().catch((e) => {
  console.error(e?.stack ?? e);
  process.exit(1);
});
