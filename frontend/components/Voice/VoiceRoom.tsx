'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { ArrowLeft, Check, Copy, Link2, Loader2, Mic, MicOff, PhoneCall, QrCode, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useSession } from '@/components/App/SessionContext';
import {
  createGuestLink,
  deleteGuestLink,
  getGuestLink,
  getLiveTeam,
  mintVoiceToken,
  postGuestVoiceTranscript,
  postVoiceTranscript,
  type LiveCrew,
} from '@/lib/api';

interface VoiceRoomProps {
  taskId: string;
}

interface Line {
  id: number;
  who: 'you' | 'aria';
  text: string;
  at: string;
}

const DEFAULT_GREETING = 'Hey! I\u2019m Aria \u2014 what can I do for you today?';

function fmtDur(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Map raw failures to actionable guidance. The LiveKit leg (browser →
 * ElevenLabs) is outside our code — blocked hosts and dead tokens look
 * identical at the socket level, so say what to check. */
function friendlyVoiceError(msg: string): string {
  const m = msg.toLowerCase();
  if (/notallowed|permission|denied|notfound|devices|microphone/i.test(msg)) {
    return 'Microphone blocked — allow mic access for this site, then try again.';
  }
  if (/token|auth|unauthor|401|403|jwt|expired/i.test(msg)) {
    return 'Call token rejected — end and press Talk again for a fresh token.';
  }
  return 'Could not reach the voice server — disable any ad-blocker/VPN for this site and retry.';
}

function TalkSession({
  teamName,
  minutesLeft,
  greeting,
  getToken,
  flushTarget,
}: {
  teamName: string;
  minutesLeft: number;
  greeting: string;
  getToken: () => Promise<{ token: string }>;
  /** Where call turns flush for thread history (agent + memory loop). */
  flushTarget: { taskId: string; token: string } | { linkId: string };
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const idRef = useRef(0);
  const startGuard = useRef(false);
  // Transcript loopback: browser-kept lines flush into the concierge thread
  // history (hang-up + every 10 turns) so the crew and its memory tools can
  // see the call. Silent — Talk never waits on it.
  const callIdRef = useRef('');
  const sentRef = useRef(0);
  const linesRef = useRef<Line[]>([]);
  linesRef.current = lines;
  const flush = useCallback(() => {
    const unsent = linesRef.current.slice(sentRef.current);
    if (unsent.length === 0 || !callIdRef.current) return;
    const turns = unsent.map((l) => ({ vid: l.id, who: l.who, text: l.text, at: l.at }));
    const done = (n: number) => {
      sentRef.current += n;
    };
    if ('linkId' in flushTarget) {
      void postGuestVoiceTranscript(flushTarget.linkId, callIdRef.current, turns)
        .then(() => done(turns.length))
        .catch(() => {});
    } else {
      void postVoiceTranscript(flushTarget.token, flushTarget.taskId, callIdRef.current, turns)
        .then(() => done(turns.length))
        .catch(() => {});
    }
  }, [flushTarget]);

  useEffect(() => {
    if (lines.length - sentRef.current >= 10) flush();
  }, [lines, flush]);

  useEffect(() => {
    if (!connectedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [connectedAt]);

  const push = useCallback((who: Line['who'], text: string) => {
    const v = text.trim();
    if (!v) return;
    idRef.current += 1;
    setLines((prev) => [...prev, { id: idRef.current, who, text: v.slice(0, 2000), at: new Date().toISOString() }]);
  }, []);

  const conversation = useConversation({
    onConnect: () => {
      callIdRef.current = crypto.randomUUID();
      sentRef.current = 0;
      setConnectedAt(Date.now());
      setError(null);
      setErrorDetail(null);
    },
    onDisconnect: () => {
      flush();
      setConnectedAt(null);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e ?? 'Voice error');
      console.debug('[voice] session error:', e);
      setError(friendlyVoiceError(msg));
      try {
        setErrorDetail(JSON.stringify(e)?.slice(0, 300) ?? null);
      } catch {
        setErrorDetail(null);
      }
    },
    onMessage: (m: unknown) => {
      const mm = m as { message?: unknown; text?: unknown; source?: unknown; role?: unknown };
      const text = String(mm?.message ?? mm?.text ?? '');
      const src = String(mm?.source ?? mm?.role ?? '').toLowerCase();
      if (!text.trim()) return;
      push(src.includes('user') || src.includes('human') ? 'you' : 'aria', text);
    },
  });

  const connected = conversation.status === 'connected' || conversation.status === 'connecting';
  const speaking = conversation.mode === 'speaking';

  const start = async () => {
    if (startGuard.current || connected) return;
    startGuard.current = true;
    setStarting(true);
    setError(null);
    setErrorDetail(null);
    try {
      const out = await getToken();
      await navigator.mediaDevices.getUserMedia({ audio: true });
      conversation.startSession({
        conversationToken: out.token,
        overrides: { agent: { firstMessage: greeting || undefined } },
      } as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the call.');
    } finally {
      setStarting(false);
      startGuard.current = false;
    }
  };

  const end = () => {
    try {
      conversation.endSession();
    } catch { /* already closed */ }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-4">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto py-2 text-[15px]">
        {lines.length === 0 && !connected && (
          <div className="mx-auto max-w-sm py-8 text-center">
            <p className="font-brico text-xl font-bold text-wfnavy">Talk to {teamName}</p>
            <p className="mt-1 text-sm text-wfink">Press Talk and speak — Aria answers out loud.</p>
          </div>
        )}
        {lines.map((l) =>
          l.who === 'you' ? (
            <div key={l.id} title={new Date(l.at).toLocaleString()} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-wfnavy px-4 py-2.5 text-sm text-white">
              {l.text}
            </div>
          ) : (
            <div key={l.id} title={new Date(l.at).toLocaleString()} className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-sm text-wfnavy shadow-sm">
              <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-wfcta">Aria</span>
              {l.text}
            </div>
          ),
        )}
        {connected && (
          <div className="mx-auto flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-wfnavy shadow-sm">
            <span className={`h-2 w-2 rounded-full ${speaking ? 'animate-pulse bg-wfcta' : 'bg-emerald-500'}`} />
            {speaking ? 'Aria speaking…' : 'Listening…'}
            {connectedAt !== null && <span className="tabular-nums text-wfink">{fmtDur(Math.max(0, Math.round((now - connectedAt) / 1000)))}</span>}
          </div>
        )}
        {error && (
          <div className="text-center">
            <p className="text-xs text-red-600">{error}</p>
            {errorDetail && <p className="mt-1 break-all font-mono text-[10px] text-wfink">{errorDetail}</p>}
          </div>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-2 py-2">
        <p className="text-[11px] text-wfink/70">Calls may be remembered to serve you better.</p>
        {!connected ? (
          <>
            <button
              onClick={() => void start()}
              disabled={starting || minutesLeft <= 0}
              aria-label="Talk"
              title={minutesLeft > 0 ? 'Talk' : 'Rental ended'}
              className="grid h-24 w-24 place-items-center rounded-full bg-wfnavy text-white shadow-lg transition hover:opacity-90 disabled:opacity-40"
            >
              {starting ? <Loader2 className="h-8 w-8 animate-spin" strokeWidth={2.2} /> : <Mic className="h-8 w-8" strokeWidth={2.2} />}
            </button>
            <p className="text-xs font-semibold text-wfink">
              {starting ? 'Connecting…' : minutesLeft > 0 ? 'Tap to talk' : 'Rental ended'}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => conversation.setMuted(!conversation.isMuted)}
              aria-label={conversation.isMuted ? 'Unmute' : 'Mute'}
              className="grid h-12 w-12 place-items-center rounded-full bg-white text-wfnavy shadow-md hover:bg-slate-50"
            >
              {conversation.isMuted ? <MicOff className="h-5 w-5" strokeWidth={2.2} /> : <Mic className="h-5 w-5" strokeWidth={2.2} />}
            </button>
            <button
              onClick={end}
              aria-label="End call"
              className="grid h-16 w-16 place-items-center rounded-full bg-red-600 text-white shadow-lg hover:opacity-90"
            >
              <PhoneCall className="h-6 w-6 rotate-[135deg]" strokeWidth={2.2} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ShareBlock({ token, taskId }: { token: string; taskId: string }) {
  const [linkId, setLinkId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getGuestLink(token, taskId)
      .then((o) => alive && setLinkId(o.linkId))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, taskId]);

  const url = linkId && typeof window !== 'undefined' ? `${window.location.origin}/voice/g/${linkId}` : null;

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const out = await createGuestLink(token, taskId);
      setLinkId(out.linkId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    setErr(null);
    try {
      await deleteGuestLink(token, taskId);
      setLinkId(null);
      setShowQr(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not revoke the link.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section className="mx-auto w-full max-w-2xl px-4 pb-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-wfink">Share with customers</p>
        <p className="mt-1 text-xs leading-relaxed text-wfink">
          Anyone with the link can talk to Aria — no wallet needed. Minutes burn from this rental.
        </p>
        {!linkId ? (
          <button
            onClick={() => void create()}
            disabled={busy}
            className="mt-3 flex items-center gap-2 rounded-full bg-wfnavy px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} /> : <Link2 className="h-4 w-4" strokeWidth={2.2} />}
            Create guest link
          </button>
        ) : (
          <div className="mt-3">
            <div className="flex items-center gap-2 rounded-xl bg-wfice px-3 py-2">
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-wfnavy">{url}</p>
              <button
                onClick={() => void copy()}
                aria-label="Copy guest link"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-wfnavy hover:bg-slate-100"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" strokeWidth={2.2} /> : <Copy className="h-4 w-4" strokeWidth={2.2} />}
              </button>
              <button
                onClick={() => setShowQr((s) => !s)}
                aria-label="Show QR code"
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-wfnavy hover:bg-slate-100 ${showQr ? 'bg-white' : ''}`}
              >
                <QrCode className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>
            {showQr && url && (
              <div className="mt-3 flex justify-center rounded-xl bg-white p-4">
                <QRCodeSVG value={url} size={180} />
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => void create()}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-full bg-wfice px-4 py-2 text-xs font-bold text-wfnavy hover:bg-slate-200 disabled:opacity-40"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
                New link (invalidates old)
              </button>
              <button
                onClick={() => void revoke()}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-full bg-wfice px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                Revoke
              </button>
            </div>
          </div>
        )}
        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      </div>
    </section>
  );
}

export { TalkSession };
export default function VoiceRoom({ taskId }: { taskId: string }) {
  const { token, signedIn } = useSession();
  const [crew, setCrew] = useState<LiveCrew | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    getLiveTeam(token)
      .then((crews) => setCrew(crews.find((r) => r.taskId === taskId) ?? null))
      .catch(() => setCrew(null))
      .finally(() => setLoading(false));
  }, [token, taskId]);

  if (!signedIn) {
    return (
      <main className="grid min-h-screen flex-1 place-items-center bg-wfthread px-6">
        <p className="text-sm text-wfink">Connect a wallet and sign in to use voice.</p>
      </main>
    );
  }
  if (loading) {
    return (
      <main className="grid min-h-screen flex-1 place-items-center bg-wfthread px-6">
        <p className="text-sm text-wfink">Loading crew…</p>
      </main>
    );
  }
  if (!crew) {
    return (
      <main className="grid min-h-screen flex-1 place-items-center bg-wfthread px-6">
        <div className="text-center">
          <p className="font-brico text-xl font-bold text-wfnavy">No live rental</p>
          <p className="mt-1 text-sm text-wfink">Hire a team first — voice needs a working rental with a live sandbox.</p>
          <Link href="/app" className="mt-4 inline-block rounded-full bg-wfnavy px-5 py-2.5 text-sm font-bold text-white">
            Back to crews
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col bg-wfthread">
      <header className="flex items-center gap-2 px-4 py-3.5">
        <Link href="/app" aria-label="Back to crews" className="grid h-9 w-9 place-items-center rounded-full bg-white text-wfnavy shadow-sm hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-brico text-lg font-bold text-wfnavy">Voice · {crew.team}</p>
          <p className="text-xs tabular-nums text-wfink">{crew.minutesLeft}m left of rental</p>
        </div>
        <span className="w-9" />
      </header>

      <ConversationProvider>
        <TalkSession
          teamName={crew.team}
          minutesLeft={crew.minutesLeft}
          greeting={DEFAULT_GREETING}
          getToken={async () => mintVoiceToken(token!, taskId)}
          flushTarget={{ taskId, token: token! }}
        />
      </ConversationProvider>
      <ShareBlock token={token!} taskId={taskId} />
    </main>
  );
}

function ArrowLeftLeft() {
  return null;
}
