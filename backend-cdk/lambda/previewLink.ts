import { createHmac } from 'node:crypto';

const SECRET = process.env.PREVIEW_SECRET ?? '';
const BASE = 'https://8lgt6x9mn8.execute-api.ap-southeast-1.amazonaws.com/prod';

/** 15-minute bearer preview URL for a task VM port (same scheme as preview.ts). */
export function previewUrl(taskId: string, port = 5173): string | null {
  if (!SECRET) return null;
  const exp = String(Math.floor(Date.now() / 1000) + 15 * 60);
  const portStr = String(port);
  const sig = createHmac('sha256', SECRET).update(`${taskId}.${portStr}.${exp}`).digest('hex');
  return `${BASE}/a2a/sandbox/preview/view/${taskId}/${portStr}/?sig=${sig}&exp=${exp}`;
}
