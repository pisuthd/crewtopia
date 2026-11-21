/**
 * ops/vm-task-spike — first real inference inside the VM: boot →
 * /hooks/run with MODAL_API_KEY (from backend-cdk/.env, never logged) →
 * POST /task → poll for the agent's reply → terminate + verify.
 *
 * Run:  npm run ops:vm-task
 */
import { readFileSync } from "node:fs";
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

function modalKey(): string {
  const env = readFileSync("../backend-cdk/.env", "utf8");
  const m = /^NEGOTIATOR_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
  if (!m) throw new Error("NEGOTIATOR_API_KEY missing in backend-cdk/.env");
  return m;
}

async function main() {
  const MODAL_API_KEY = modalKey();
  console.log("[vm-task] key loaded:", MODAL_API_KEY.length, "chars (value never logged)");

  const run = await vm.send(
    new RunMicrovmCommand({
      imageIdentifier: IMAGE,
      runHookPayload: JSON.stringify({ ownerId: "crewtopia-spike", computerId: "spike-02" }),
      ingressNetworkConnectors: [CONN("ALL_INGRESS")],
      egressNetworkConnectors: [CONN("INTERNET_EGRESS")],
      idlePolicy: { autoResumeEnabled: false, maxIdleDurationSeconds: 900, suspendedDurationSeconds: 604800, maximumDurationInSeconds: 3600 },
      maximumDurationInSeconds: 3600,
    }),
  );
  const id = (run as any).microvmIdentifier ?? (run as any).microvmId ?? (run as any).microvmArn ?? "";
  console.log("[vm-task] booted:", id, "| run keys:", Object.keys(run as any).join(","));

  let endpoint = "";
  for (let i = 0; i < 40; i++) {
    const got: any = await vm.send(new GetMicrovmCommand({ microvmIdentifier: id }));
    endpoint = got.endpoint ?? "";
    if (endpoint && /running/i.test(JSON.stringify(got.state))) break;
    await sleep(15000);
  }
  if (!endpoint) throw new Error("VM never RUNNING");

  try {
    const tok: any = await vm.send(new CreateMicrovmAuthTokenCommand({ microvmIdentifier: id, allowedPorts: [{ port: 8080 }], expirationInMinutes: 60 }));
    const H = { "X-aws-proxy-auth": tok?.authToken?.["X-aws-proxy-auth"] ?? "" };

    const hook = await fetch(`https://${endpoint}/hooks/run`, {
      method: "POST",
      headers: { ...H, "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "crewtopia-spike", computerId: "spike-02", secrets: { MODAL_API_KEY, PROVIDER_API_KEY: MODAL_API_KEY }, usageToken: "spike", apiUrl: "https://example.com" }),
    });
    console.log("[vm-task] hooks/run →", hook.status, (await hook.text()).slice(0, 200));

    const task = await fetch(`https://${endpoint}/task`, {
      method: "POST",
      headers: { ...H, "content-type": "application/json" },
      body: JSON.stringify({ text: "Reply with exactly: HELLO FROM THE SANDBOX. No tools, just the words.", ownerId: "crewtopia-spike" }),
    });
    const taskBody = await task.text();
    console.log("[vm-task] POST /task →", task.status, taskBody.slice(0, 500));

    // Follow the run: try common shapes for run id, poll events.
    let runId = "";
    try {
      const j = JSON.parse(taskBody);
      runId = j.runId ?? j.run_id ?? j.id ?? j.taskId ?? "";
    } catch { /* plain text */ }
    if (runId) {
      for (let i = 0; i < 32; i++) {
        await sleep(15000);
        const ev = await fetch(`https://${endpoint}/runs/${runId}/events`, { headers: H });
        const txt = await ev.text();
        console.log(`[vm-task] events poll ${i} →`, ev.status, txt.slice(0, 400).replace(/\n/g, " | "));
        if (/HELLO FROM THE SANDBOX/i.test(txt) || /completed|done|final/i.test(txt)) break;
      }
    } else {
      console.log("[vm-task] no run id in response — check shape above");
    }
  } finally {
    console.log("[vm-task] terminating...");
    await vm.send(new TerminateMicrovmCommand({ microvmIdentifier: id }));
    for (let i = 0; i < 12; i++) {
      await sleep(5000);
      try {
        const got: any = await vm.send(new GetMicrovmCommand({ microvmIdentifier: id }));
        if (/terminated/i.test(JSON.stringify(got))) break;
      } catch {
        console.log("[vm-task] VM gone (TERMINATED)");
        break;
      }
    }
  }
  console.log("\nOK — vm-task spike complete.");
}

main().catch((e) => {
  console.error(e?.stack ?? e);
  process.exit(1);
});
