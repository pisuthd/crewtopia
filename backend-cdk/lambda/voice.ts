// Speech Engine lifecycle for voice rentals (Phase 2). One engine per
// task: ws_url points at the renter's sandbox /voice-chat, request_headers
// carry a fresh proxy-auth token (refreshed when older than 45 min), and
// auth.enableAuth forces browser clients through our token endpoint.
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { getTask, touchTask } from './a2a/store';
import { resolveSandboxVm } from './sandboxStore';
import { vmToken } from './a2a/vm';

const HEADERS_TTL_MS = 45 * 60_000;

/** Greeting prompt the chat UI sends for never-touched threads. Internal
 * instruction, never user speech — filtered from history everywhere and
 * excluded from the voice digest below. Single source of truth (the app
 * chat handler imports this). */
export const HELLO_PROMPT =
  'Introduce yourself briefly in character and ask what they need. One short message, no tools, no work yet.';

/** Recent text-thread context for the voice concierge: lead's last few
 * turns + one line per other member. Lets a caller reference what was
 * discussed in chat ("as I told Reef yesterday...") without replaying
 * whole transcripts. Best-effort — never blocks Talk. */
async function threadDigest(
  endpoint: string,
  token: string,
  taskId: string,
  roster: Array<{ role: string; name: string }>,
): Promise<string> {
  try {
    const picks = roster.slice(0, 4).map((m, i) => ({ role: String(m.role), name: String(m.name), n: i === 0 ? 6 : 2 }));
    const parts: string[] = [];
    await Promise.all(
      picks.map(async (p) => {
        const r = await vmFetchJson(endpoint, token, `/history/${encodeURIComponent(`rent:${taskId}#${p.role.toLowerCase()}`)}`).catch(
          () => ({ status: 0, json: {} as any }),
        );
        const msgs: Array<{ role?: string; text?: string }> = Array.isArray((r.json as any)?.messages) ? (r.json as any).messages : [];
        const clean = msgs
          .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
          .filter((m) => !(/^Rental \S+ is now FUNDED and live/.test(String(m.text)) || String(m.text).trim() === HELLO_PROMPT))
          .slice(-p.n);
        if (clean.length > 0) {
          parts.push(
            `[${p.name} thread, newest last] ` +
              clean.map((m) => `${m.role === 'user' ? 'buyer' : p.name}: ${String(m.text).slice(0, 300)}`).join(' / '),
          );
        }
      }),
    );
    if (parts.length === 0) return '';
    return `\nText threads so far (for continuity — the buyer may reference these):\n${parts.join('\n').slice(0, 2000)}`;
  } catch {
    return '';
  }
}

function elevenKey(): string {
  return process.env.ELEVENLABS_API_KEY ?? '';
}

function client(): ElevenLabsClient {
  const key = elevenKey();
  if (!key) throw new Error('ELEVENLABS_API_KEY is not configured');
  return new ElevenLabsClient({ apiKey: key });
}

/** Remaining rental seconds (floor 60) — caps the voice call. */
function rentalSecondsLeft(task: any): number {
  const funded = Number(task?.quote?.fundedSeconds ?? 0) || 0;
  const since = task?.workingSince ? Date.parse(task.workingSince) : NaN;
  const elapsed = Number.isFinite(since) ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0;
  return Math.min(7200, Math.max(60, funded - elapsed));
}

async function vmFetchJson(
  endpoint: string,
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; json: any }> {
  const r = await fetch(`https://${endpoint}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'X-aws-proxy-auth': token,
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!r) return { status: 0, json: {} };
  const jb = await r.json().catch(() => ({}));
  return { status: r.status, json: jb };
}

export interface VoiceEngine {
  engineId: string;
  wsUrl: string;
  maxDurationSeconds: number;
}

/**
 * Ensure a Speech Engine for this rental: reuse the recorded one (fixing
 * ws_url/headers when the sandbox endpoint rotated or headers aged), else
 * create it. Then make sure the VM has it attached. Returns null when the
 * rental can't talk right now (caller maps to 404/409).
 */
export async function ensureVoiceEngine(
  taskId: string,
  owner: string,
  opts?: { speakRoles?: string[] },
): Promise<VoiceEngine | null> {
  const task: any = await getTask(taskId).catch(() => null);
  if (!task || !task.buyer || String(task.buyer).toLowerCase() !== owner.toLowerCase()) return null;
  if (task.status !== 'working') return null;
  const sb = await resolveSandboxVm(owner.toLowerCase()).catch(() => null);
  if (!sb) return null;
  let proxyToken: string;
  try {
    proxyToken = await vmToken(sb.vmId);
  } catch {
    return null;
  }

  const c = client();
  const wsUrl = `wss://${sb.endpoint}/voice-chat`;
  const maxDurationSeconds = rentalSecondsLeft(task);
  let engineId: string | null = task.voiceEngineId ?? null;

  const readEngine = async (id: string): Promise<any | null> => {
    try {
      const eng: any = await c.speechEngine.get(id);
      return eng?.config ?? eng ?? null;
    } catch {
      return null;
    }
  };

  if (engineId) {
    const cfg = await readEngine(engineId);
    if (!cfg) {
      engineId = null; // gone server-side — recreate below
    } else {
      const staleUrl = cfg?.speechEngine?.wsUrl !== wsUrl;
      const headersAt = Date.parse(String(task.voiceEngineHeadersAt ?? ''));
      const staleHeaders = !Number.isFinite(headersAt) || Date.now() - headersAt > HEADERS_TTL_MS;
      if (staleUrl || staleHeaders) {
        try {
          await c.speechEngine.update(engineId, {
            speechEngine: {
              wsUrl,
              requestHeaders: { 'X-aws-proxy-auth': proxyToken },
            },
          } as any);
          await touchTask(taskId, { voiceEngineHeadersAt: new Date().toISOString() }).catch(() => {});
        } catch (e) {
          console.error(`[voice] engine update failed: ${e instanceof Error ? e.message : String(e)}`);
          engineId = null; // fall through to recreate
        }
      }
    }
  }

  if (!engineId) {
    const created: any = await c.speechEngine.create({
      name: `crewtopia-voice-${taskId.slice(0, 8)}`,
      speechEngine: {
        wsUrl,
        requestHeaders: { 'X-aws-proxy-auth': proxyToken },
      },
      auth: { enableAuth: true },
      overrides: { firstMessage: true },
      conversation: { maxDurationSeconds },
      callLimits: { agentConcurrencyLimit: 3, dailyLimit: 200, burstingEnabled: false } as any,
      tags: ['crewtopia', 'voice', taskId.slice(0, 8)],
    } as any);
    engineId = created?.engineId ?? created?.speechEngineId ?? created?.speech_engine_id;
    if (!engineId) throw new Error('engine create returned no id');
    await touchTask(taskId, { voiceEngineId: engineId, voiceEngineHeadersAt: new Date().toISOString() }).catch(() => {});
    console.log(`[voice] engine ${engineId} created for task ${taskId}`);
  }

  // VM attach: only (re)attach when the VM holds a different engine.
  // Speaker ticks ride along: the lead always joins; ticked members join
  // the roster so the concierge can @mention them mid-call. The lead's
  // brief is the turn system prompt (concierge persona). Falls back to the
  // stored task config (guest calls) then concierge-only.
  const fullRoster: Array<{ role: string; name: string; title: string; brief: string }> = Array.isArray(task.roster)
    ? task.roster
    : [];
  const lead = fullRoster[0];
  const storedSpeak: string[] = Array.isArray((task as any).voiceConfig?.speakers)
    ? (task as any).voiceConfig.speakers.map((r: unknown) => String(r).toLowerCase())
    : [];
  const wanted = new Set([...(opts?.speakRoles ?? []), ...storedSpeak].map((r) => String(r).toLowerCase()));
  const callRoster = fullRoster.filter((m, i) => i === 0 || wanted.has(String(m.role).toLowerCase()));
  // Identity + mission, baked into the turn system prompt: a fresh voice
  // session has no kickoff message, so without this the concierge knows
  // neither the job nor the team. Static per task (safe across guest calls —
  // no transcript leaks, only the job description and roster names).
  const teamName: string = task.quote?.displayName ?? task.teamId ?? 'Voice Crew';
  const rentalBrief: string = typeof task.brief === 'string' && task.brief.trim() ? task.brief.trim().slice(0, 1000) : '(no brief yet — ask the buyer what they want)';
  const baseBrief = lead && typeof lead.brief === 'string' && lead.brief ? lead.brief : null;
  const systemBrief =
    (baseBrief ?? `You are Aria, concierge of the ${teamName} on a live rented session.`) +
    ` Rental: ${teamName} (task ${taskId}). Buyer brief: ${rentalBrief}. ` +
    `Team on this call: ${callRoster.map((m) => `${m.name} (${m.title})`).join(', ') || 'just you'}. ` +
    `Workspace files live under rentals/${taskId}/ — check there and with the team before answering from memory.`;
  // Text-thread awareness: the voice session is fresh, but the buyer may
  // reference what was discussed in chat. Digest is static-safe (briefs +
  // roster chatter only, refreshed every Talk).
  const digest = await threadDigest(sb.endpoint, proxyToken, taskId, callRoster);
  const fullSystem = systemBrief + digest;
  // Always (re)attach on Talk: cheap, idempotent, and guarantees the brief
  // and roster above are fresh (a skipped attach would strand an old brief).
  // Verified right after — fail loudly instead of handing out a dead token.
  {
    const at = await vmFetchJson(sb.endpoint, proxyToken, '/voice-chat/attach', {
      method: 'POST',
      body: {
        engineId,
        taskId,
        ownerId: owner.toLowerCase(),
        ...(lead ? { botName: lead.name } : {}),
        system: fullSystem,
        roster: callRoster.map((m) => ({ id: m.role, name: m.name, role: m.title })),
      },
    }).catch(() => ({ status: 0, json: {} as any }));
    if (at.status !== 200 || !(at.json as any)?.attached) {
      throw new Error(`voice attach failed (vm ${at.status || 'unreachable'}) — reboot the sandbox and try again`);
    }
    const verify = await vmFetchJson(sb.endpoint, proxyToken, '/voice-chat').catch(() => ({ status: 0, json: {} as any }));
    if (verify.json?.engineId !== engineId) {
      throw new Error('voice attach did not stick — reboot the sandbox and try again');
    }
  }

  return { engineId, wsUrl, maxDurationSeconds };
}

/** Mint a browser WebRTC conversation token for an engine. */
export async function mintVoiceToken(engineId: string): Promise<string> {
  const c = client();
  const out: any = await c.conversationalAi.conversations.getWebrtcToken({ agentId: engineId });
  const token = String(out?.token ?? '');
  if (!token) throw new Error('token mint returned empty');
  return token;
}

/** Best-effort teardown: detach the VM voice server + delete the engine. */
export async function teardownVoice(taskId: string, owner: string): Promise<void> {
  const task: any = await getTask(taskId).catch(() => null);
  try {
    const sb = await resolveSandboxVm(owner.toLowerCase()).catch(() => null);
    if (sb) {
      const token = await vmToken(sb.vmId).catch(() => null);
      if (token) {
        await vmFetchJson(sb.endpoint, token, '/voice-chat', { method: 'DELETE' }).catch(() => null);
      }
    }
  } catch {
    // VM already gone — nothing to detach
  }
  const engineId: string | null = task?.voiceEngineId ?? null;
  if (engineId) {
    try {
      await client().speechEngine.delete(engineId);
      console.log(`[voice] engine ${engineId} deleted (task ${taskId} ended)`);
    } catch {
      // already deleted or never created — ignore
    }
    await touchTask(taskId, { voiceEngineId: null, voiceEngineHeadersAt: null }).catch(() => {});
  }
}
