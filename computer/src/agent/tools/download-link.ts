// Download-link tool: mint the 7-day presigned GET for this computer's
// delivery zip so the crew shares it with the buyer directly in chat.
// Same usage-token auth as the deliver tool; no Ember detour.
import { tool } from '@openai/agents';
import { z } from 'zod';

import { guarded, approvalPolicy, type GuardOpts } from '../../core/guard.js';

function apiBase(): string {
  return (process.env.CREWTOPIA_API_URL ?? '').replace(/\/+$/, '');
}

export function createDownloadLinkTool(opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    strict: true,
    name: 'download_link',
    description:
      'Get the buyer download link for the delivered project: mints a fresh 7-day URL for a delivery zip and share it verbatim. ' +
      'Pass task_id when fetching a hired rental link from the personal sandbox; omit it on a task-booted computer (uses its own delivery). ' +
      'Call when the buyer asks for the source/project files. Fails when nothing was delivered yet — run the deliver tool first.',
    parameters: z.object({
      task_id: z.string().optional().describe('Rental task id when fetching a hired-work download link (omit to use this computer)'),
    }),
    execute: guarded(
      'deliver',
      () => 'workspace',
      async (a: { task_id?: string }) => {
        const base = apiBase();
        const token = process.env.USAGE_TOKEN ?? '';
        const computerId = process.env.COMPUTER_ID ?? '';
        if (!base || !token || !computerId) {
          return 'Download link unavailable: this computer was not booted by a rental (missing API base, token, or computer id).';
        }
        try {
          const r = await fetch(`${base}/a2a/sandbox/delivery/get-url`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ computerId, token, ...(a.task_id ? { taskId: a.task_id } : {}) }),
            signal: AbortSignal.timeout(20_000),
          });
          if (r.status === 404) return 'No delivery uploaded yet — run the deliver tool first, then ask again.';
          if (!r.ok) return `Download link mint failed (status ${r.status}): ${(await r.text()).slice(0, 200)}`;
          const { url } = (await r.json()) as { url?: string };
          if (!url) return 'Download link mint failed: empty response.';
          return `Share this 7-day download link verbatim: ${url}`;
        } catch (err) {
          return `Download link mint failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
      opts,
    ),
    needsApproval: approvalPolicy('deliver', () => 'workspace'),
  });
}
