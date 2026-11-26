import type { Server } from 'node:http';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { elevenlabsApiKey } from '../providers/providers.js';
import { getRun, startRun, type StartRunOpts } from '../runs/runner.js';

export interface VoiceAttachOpts {
  engineId: string;
  taskId: string;
  ownerId?: string;
  /** Concierge system brief (defaults to a spoken-turn brief). */
  system?: string;
  botName?: string;
  roster?: StartRunOpts['roster'];
  provider?: string;
  model?: string;
}

interface VoiceSession {
  engineId: string;
  taskId: string;
  conversationId: string;
  close: () => Promise<void> | void;
}

let active: VoiceSession | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Default concierge brief for voice turns (spoken, short, no markdown). */
export function defaultVoiceBrief(taskId: string): string {
  return (
    `You are Aria, concierge of the Voice Crew on a live rented session (${taskId}). ` +
    `You are speaking out loud — keep every reply to one or two short sentences, plain words, no lists, no markdown, no URLs. ` +
    `If the buyer asks for something needing lookup or records, say you will check with the team, @mention the right teammate in-thread, and relay their answer conversationally. ` +
    `Never claim work is done until it is.`
  );
}

/**
 * Stream one runner turn as an async iterable of text chunks for
 * session.sendResponse(). Polls the run's events in-process: same tools,
 * same session memory as the text threads. Fast default model (voice needs
 * first audio in seconds, not a reasoning trace), bridge line if the first
 * chunk is slow, hard stop well inside the call window.
 */
const FIRST_CHUNK_GRACE_MS = 12_000;
const VOICE_DEFAULT_MODEL = 'muse-spark-1.3-contributor';
const VOICE_DEFAULT_PROVIDER = 'meta';

async function* streamRunChunks(
  runId: string,
  signal: AbortSignal,
  maxMs = 4 * 60_000,
): AsyncGenerator<string, void, unknown> {
  const t0 = Date.now();
  let cursor = 0;
  let bridged = false;
  for (;;) {
    if (signal.aborted) return;
    if (Date.now() - t0 > maxMs) return;
    const run = getRun(runId);
    if (!run) return;
    const fresh = run.events.slice(cursor);
    cursor = run.events.length;
    for (const e of fresh) {
      if (signal.aborted) return;
      if (e.type === 'chunk' && typeof e.chunk === 'string' && e.chunk) yield e.chunk;
      else if (e.type === 'error') return;
    }
    // Slow start (thinking model vs the 15s cascade timeout): say something
    // so ElevenLabs keeps the turn alive while the real reply streams in.
    if (!bridged && cursor <= 1 && Date.now() - t0 > FIRST_CHUNK_GRACE_MS) {
      bridged = true;
      console.log(`[voice] bridging slow start for run ${runId}`);
      yield 'One moment while I check that for you.';
    }
    // Parked mid-turn (approval/question): stop the voice turn here — the
    // buyer resolves it in the chat thread, then talks again.
    if (run.parked) {
      if (cursor <= 1) yield 'I need your approval on something — please check the chat thread, then continue.';
      return;
    }
    if (run.done) return;
    await sleep(60);
  }
}

/** Attach the ElevenLabs Speech Engine WS handler for one rental. Replaces any previous attachment. */
export async function attachVoiceEngine(
  server: Server,
  opts: VoiceAttachOpts,
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const key = elevenlabsApiKey();
  if (!key) return { ok: false, error: 'ELEVENLABS_API_KEY is not configured on this computer' };
  if (!opts.engineId || !opts.taskId) return { ok: false, error: 'needs { engineId, taskId }' };
  try {
    if (active) {
      try {
        await active.close();
      } catch {
        /* already gone */
      }
      active = null;
    }
    const client = new ElevenLabsClient({ apiKey: key });
    const engine = await client.speechEngine.get(opts.engineId);
    const system = opts.system ?? defaultVoiceBrief(opts.taskId);
    // Per-call conversation: the SDK session id isolates each call's memory
    // (guests must not read each other's turns). Cross-call memory lives in
    // Keeper's workspace files, not the session.
    const sessionKey = (session: any): string => {
      const cid = typeof session?.conversationId === 'string' ? session.conversationId : '';
      return `voice:${opts.taskId}:${cid || 'live'}`;
    };

    const attachment: any = await (engine as any).attach(server, '/voice-chat', {
      debug: false,
      onInit: (conversationId_: string) => {
        console.log(`[voice] session started ${conversationId_} (task ${opts.taskId})`);
      },
      onTranscript: async (transcript: Array<{ role: string; content: string }>, sig: AbortSignal, session: any) => {
        // Latest user turn only — the runner session keyed by conversationId
        // already holds the history, so we never replay the transcript.
        const lastUser = [...transcript].reverse().find((m) => m?.role === 'user' && typeof m.content === 'string' && m.content.trim());
        const text = (lastUser?.content ?? '').trim().slice(0, 2000);
        if (!text) return;
        const tTurn0 = Date.now();
        const run = startRun(text, {
          conversationId: sessionKey(session),
          system,
          provider: opts.provider ?? VOICE_DEFAULT_PROVIDER,
          model: opts.model ?? VOICE_DEFAULT_MODEL,
          ...(opts.roster ? { roster: opts.roster } : {}),
          ...(typeof opts.botName === 'string' && opts.botName ? { botName: opts.botName.slice(0, 40) } : {}),
          ...(typeof opts.ownerId === 'string' && opts.ownerId ? { ownerId: opts.ownerId.slice(0, 128) } : {}),
        });
        try {
          await session.sendResponse(streamRunChunks(run.id, sig));
          console.log(`[voice] turn done in ${Date.now() - tTurn0}ms (run ${run.id})`);
        } catch (e) {
          // A failed send must never kill the attach — log and keep serving.
          console.error(`[voice] sendResponse failed for run ${run.id}:`, e instanceof Error ? e.message : String(e));
        }
      },
      onClose: (session: any) => {
        console.log(`[voice] session ended ${session?.conversationId ?? ''}`);
      },
      onError: (err: unknown) => {
        console.error('[voice] engine error:', err instanceof Error ? err.message : String(err));
      },
    });
    const close = async () => {
      try {
        if (typeof attachment?.close === 'function') await attachment.close();
      } catch {
        /* already gone */
      }
    };
    active = { engineId: opts.engineId, taskId: opts.taskId, conversationId: `voice:${opts.taskId}`, close };
    console.log(`[voice] attached engine ${opts.engineId} for task ${opts.taskId}`);
    return { ok: true, conversationId: `voice:${opts.taskId}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Detach the current voice engine (rental end). Keeps the HTTP server up. */
export async function detachVoiceEngine(): Promise<{ ok: true; detached: boolean }> {
  if (!active) return { ok: true, detached: false };
  try {
    await active.close();
  } catch {
    /* already gone */
  }
  console.log(`[voice] detached engine ${active.engineId} (task ${active.taskId})`);
  active = null;
  return { ok: true, detached: true };
}

export function voiceStatus(): { attached: boolean; engineId: string | null; taskId: string | null } {
  return { attached: !!active, engineId: active?.engineId ?? null, taskId: active?.taskId ?? null };
}
