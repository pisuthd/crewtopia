/**
 * Explicit suspend/resume probe: bypasses the app and calls the platform
 * directly to verify the suspend mechanism (and our hook) works.
 * Run: VMID=<microvm-id> npx tsx computer/scripts/image/bisect-suspend.ts (repo root)
 */
import { GetMicrovmCommand, ResumeMicrovmCommand, SuspendMicrovmCommand } from '@aws-sdk/client-lambda-microvms';
import { mv, waitFor } from './config.js';

const vmId = process.env.VMID ?? '';
if (!vmId) throw new Error('need VMID');

async function state(): Promise<string> {
  const r: any = await mv.send(new GetMicrovmCommand({ microvmIdentifier: vmId })).catch((e: Error) => ({ state: `PROBE-FAILED: ${e.message}` }));
  return String(r.state ?? 'unknown');
}

async function main(): Promise<void> {
  const start = await state();
  console.log(`start state: ${start}`);
  if (start !== 'SUSPENDED') {
    console.log('suspending...');
    await mv.send(new SuspendMicrovmCommand({ microvmIdentifier: vmId }));
    const s = await waitFor('suspended', async () => ((await state()) === 'SUSPENDED' ? true as const : null), { intervalMs: 10000, timeoutMs: 5 * 60_000 }).catch(() => null);
    console.log(`after suspend: ${await state()}`);
    if (!s) throw new Error('never reached SUSPENDED');
    await new Promise((r) => setTimeout(r, 30000));
  } else {
    console.log('already suspended — going straight to resume');
  }
  console.log('resuming...');
  await mv.send(new ResumeMicrovmCommand({ microvmIdentifier: vmId }));
  await waitFor('running', async () => ((await state()) === 'RUNNING' ? true as const : null), { intervalMs: 10000, timeoutMs: 5 * 60_000 });
  console.log(`after resume: ${await state()}`);
  console.log('SUSPEND+RESUME OK');
}

void main();
