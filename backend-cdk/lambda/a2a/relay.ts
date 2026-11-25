import { GetMicrovmCommand, ResumeMicrovmCommand, SuspendMicrovmCommand } from '@aws-sdk/client-lambda-microvms';
import { putTask } from './store';
import { vmClient } from './clients';
import { vmToken } from './vm';
import type { StoredTask } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function vmFetch(task: StoredTask, path: string, init?: RequestInit) {
  const token = await vmToken(task.vm!.vmId);
  const res = await fetch(`https://${task.vm!.endpoint}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'X-aws-proxy-auth': token, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch { /* plain text */ }
  return { status: res.status, text, json };
}

/** Suspend a task VM (files survive suspend; resume restores them). */
export async function suspendVm(task: StoredTask): Promise<string> {
  if (!task.vm?.vmId || task.vm.terminatedAt || task.vm.suspendedAt) return 'already suspended or gone';
  try {
    await vmFetch(task, '/hooks/suspend', { method: 'POST', body: '{}' }).catch(() => null);
    await vmClient.send(new SuspendMicrovmCommand({ microvmIdentifier: task.vm.vmId }));
    task.vm.suspendedAt = new Date().toISOString();
    await putTask(task);
    return 'suspended';
  } catch (e) {
    return `suspend failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Resume a suspended task VM and wait for RUNNING. */
export async function resumeVm(task: StoredTask): Promise<void> {
  if (!task.vm?.vmId || task.vm.terminatedAt || !task.vm.suspendedAt) return;
  await vmClient.send(new ResumeMicrovmCommand({ microvmIdentifier: task.vm.vmId }));
  for (let i = 0; i < 24; i++) {
    await sleep(10000);
    const got: any = await vmClient.send(new GetMicrovmCommand({ microvmIdentifier: task.vm!.vmId }));
    if (got.endpoint && /running/i.test(JSON.stringify(got.state))) {
      task.vm.endpoint = got.endpoint;
      delete task.vm.suspendedAt;
      await putTask(task);
      return;
    }
  }
  throw new Error('VM did not resume in time');
}
