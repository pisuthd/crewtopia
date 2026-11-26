// Runtime config. Two keys, strictly separated:
// - PROVIDER_API_KEY (Meta, api.meta.ai): chat models AND grounded search +
//   voice transcription. Injected per-VM via /hooks/run, never baked in.
// - MODAL_API_KEY: legacy open-weights endpoint. Only required when the
//   workspace providers.json catalog still references it (crewtopia images
//   are meta-only, so it is normally unset).
// Locally both come from .env; on the MicroVM both are embedded privately.
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

config({ path: '.env' });

export const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? './workspace';

function keystore(): Record<string, string> {
  const p = join(WORKSPACE_DIR, '.wayfind', 'keys.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

const keys = keystore();

export const PROVIDER_BASE_URL = process.env.PROVIDER_BASE_URL ?? 'https://api.meta.ai/v1';
export const PROVIDER_MODEL = process.env.PROVIDER_MODEL ?? 'zai-org/GLM-5.3-Flash';
export const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY ?? keys.PROVIDER_API_KEY ?? '';
export const MODAL_API_KEY = process.env.MODAL_API_KEY ?? keys.MODAL_API_KEY ?? '';

export const PORT = Number(process.env.PORT ?? 8080);

/** Live check (env or keystore written later by /run) — never the import snapshot. */
export function keysReady(): boolean {
  const providerOk = Boolean(process.env.PROVIDER_API_KEY ?? drawKeyLive('PROVIDER_API_KEY'));
  if (!providerOk) return false;
  // Legacy modal key only matters when the catalog actually references it.
  if (!catalogUsesModal()) return true;
  return Boolean(process.env.MODAL_API_KEY ?? drawKeyLive('MODAL_API_KEY'));
}

/** True when workspace/providers.json references a MODAL_API_KEY-backed provider. */
function catalogUsesModal(): boolean {
  try {
    const p = join(WORKSPACE_DIR, 'providers.json');
    if (!existsSync(p)) return true; // unknown catalog — keep legacy requirement
    const raw = readFileSync(p, 'utf8');
    return raw.includes('MODAL_API_KEY');
  } catch {
    return true;
  }
}

function drawKeyLive(name: string): string | null {
  try {
    const p = join(WORKSPACE_DIR, '.wayfind', 'keys.json');
    if (!existsSync(p)) return null;
    const v = (JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>)[name];
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

/** Local-dev gate: cloud boot skips this (keys arrive via /run). */
export function requireApiKey(): string {
  if (!keysReady()) {
    console.error('Missing API keys (.env or workspace keystore). In cloud, POST /hooks/run first.');
    process.exit(1);
  }
  return PROVIDER_API_KEY;
}
