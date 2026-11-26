// Deliver tool: zip the project (source, minus junk) and upload it to the
// backend deliveries bucket via presigned PUT. Reef calls this when Taylor
// declares the build done; the buyer downloads via the submit-time link.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { WORKSPACE_DIR } from '../../core/config.js';

import { guarded, approvalPolicy, type GuardOpts } from '../../core/guard.js';

const ROOT = resolve(WORKSPACE_DIR);
const MAX_ZIP_BYTES = 400 * 1024 * 1024;
const EXCLUDES = ['node_modules/*', '.git/*', '.wayfind/*', '*.log', '.env*'];

function apiBase(): string {
  return (process.env.CREWTOPIA_API_URL ?? '').replace(/\/+$/, '');
}

export function createDeliverTool(opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    strict: true,
    name: 'deliver',
    description:
      'Package the finished project for handoff: zips the workspace (source included, ' +
      'node_modules/.git/.wayfind/logs/env excluded) and uploads it to the buyer handoff bucket. ' +
      'Call once when the lead declares the build done. Pass task_id when delivering hired work from a personal sandbox (omit on task-booted computers). ' +
      'Returns the delivery key — report it verbatim, then use the download_link tool when the buyer asks for the files: the download URL comes from you, not Ember.',
    parameters: z.object({
      subpath: z.string().optional().describe('Workspace-relative dir to package; defaults to the whole workspace'),
      task_id: z.string().optional().describe('Rental task id when delivering hired work from a personal sandbox (omit for task-booted VMs)'),
    }),
    execute: guarded(
      'deliver',
      () => 'workspace',
      async (a: { subpath?: string; task_id?: string }) => {
        const base = apiBase();
        const token = process.env.USAGE_TOKEN ?? '';
        const computerId = process.env.COMPUTER_ID ?? '';
        if (!base || !token || !computerId) {
          return 'Delivery unavailable: this computer was not booted by a rental (missing API base, token, or computer id).';
        }
        const target = a.subpath ? resolve(ROOT, a.subpath) : ROOT;
        if (!target.startsWith(ROOT) || !existsSync(target)) {
          return `Nothing to deliver: ${a.subpath ?? 'workspace'} does not exist.`;
        }
        const zipPath = join(ROOT, '.wayfind', 'delivery.zip');
        const zipArgs = ['-r', '-X', '-q', zipPath, '.', '-x', ...EXCLUDES];
        try {
          await new Promise<void>((resolvePromise, reject) => {
            const child = execFile('zip', zipArgs, { cwd: target, timeout: 300_000 }, (err) => {
              if (err) reject(err);
              else resolvePromise();
            });
            void child;
          });
        } catch (err) {
          return `Zip failed: ${err instanceof Error ? err.message : String(err)} — is the project present at ${a.subpath ?? 'workspace root'}?`;
        }
        const size = statSync(zipPath).size;
        if (size > MAX_ZIP_BYTES) {
          return `Delivery too large (${(size / 1024 / 1024).toFixed(0)} MB > 400 MB) — trim generated assets and retry.`;
        }
        let putUrl = '';
        let key = '';
        try {
          const r = await fetch(`${base}/a2a/sandbox/delivery/put-url`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ computerId, token, ...(a.task_id ? { taskId: a.task_id } : {}) }),
            signal: AbortSignal.timeout(20_000),
          });
          if (!r.ok) return `Handoff mint failed (status ${r.status}): ${(await r.text()).slice(0, 200)}`;
          ({ url: putUrl, key } = (await r.json()) as { url: string; key: string });
        } catch (err) {
          return `Handoff mint failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        try {
          const put = await fetch(putUrl, {
            method: 'PUT',
            headers: { 'content-type': 'application/zip' },
            body: readFileSync(zipPath),
            signal: AbortSignal.timeout(300_000),
          });
          if (!put.ok) return `Upload failed (status ${put.status}): ${(await put.text()).slice(0, 200)}`;
        } catch (err) {
          return `Upload failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        return `Delivered ${key} (${(size / 1024).toFixed(0)} KB). Report this key verbatim and stop. It is NOT a download link — when the buyer asks for the files, call download_link${a.task_id ? ` with task_id "${a.task_id}"` : ''} and share that URL.`;
      },
      opts,
    ),
    needsApproval: approvalPolicy('deliver', () => 'workspace'),
  });
}
