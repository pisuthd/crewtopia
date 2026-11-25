'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  answerBotRequest,
  answerQuestions,
  clearCrewContext,
  getGates,
  getMemberHistory,
  pollCrewChat,
  resolveApproval,
  startCrewChat,
  type ChatMessage,
  type ContextStats,
  type PendingApproval,
  type PendingBotRequest,
  type PendingQuestion,
} from '@/lib/api';

export type CrewStatus =
  | 'idle'
  | 'loading'
  | 'sending'
  | 'streaming'
  | 'blocked'
  | 'error';

const POLL_MS = 2500;
const POLL_TIMEOUT_MS = 10 * 60_000;

export interface CrewSendOpts {
  attachments?: string[];
  provider?: string;
  model?: string;
  /** Hello run: no user bubble, silent on failure. */
  hello?: boolean;
}

/** Greeting prompt for never-touched threads. Internal instruction — must
 * match the backend's HELLO_PROMPT verbatim; filtered from history. */
const HELLO_PROMPT =
  'Introduce yourself briefly in character and ask what they need. One short message, no tools, no work yet.';

export interface GateState {
  approvals: PendingApproval[];
  questions: PendingQuestion[];
  botRequests: PendingBotRequest[];
}

/**
 * Direct member thread over REST: POST /rent/crew/chat starts a VM run,
 * GET /rent/crew/chat?runId=&cursor= polls chunks until done. History loads
 * from the VM transcript (readable even after the rental expires). Parked
 * runs (approval/question gates) surface as resolvable cards; resolving
 * resumes the same run.
 */
export function useCrewChat(token: string | null, taskId: string, role: string, active: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [status, setStatus] = useState<CrewStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [context, setContext] = useState<ContextStats | null>(null);
  const [kickoffStarted, setKickoffStarted] = useState(false);
  const [gates, setGates] = useState<GateState | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const [toolCalls, setToolCalls] = useState<number | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  const aliveRef = useRef(true);
  const busyRef = useRef(false);
  const greetKeyRef = useRef('');
  const runIdRef = useRef<string | null>(null);
  const cursorRef = useRef(0);

  // Per-thread transcript. De-duped: retries/double-starts can land the same
  // line twice in the VM transcript, and legacy kickoff primers predate the
  // server-side filter — chat shows one copy of what was actually said.
  useEffect(() => {
    if (!token || !active || !taskId) return;
    aliveRef.current = true;
    setStatus('loading');
    getMemberHistory(token, taskId, role)
      .then(({ messages: msgs, context: ctx, kickoffStarted: ks }) => {
        if (!aliveRef.current) return;
        const seen = new Set<string>();
        const clean = msgs.filter((m) => {
          if (m.role === 'user' && /^Rental \S+ is now FUNDED and live/.test(m.text)) return false;
          // Greeting prompt (Fix A): internal instruction, never render it.
          if (m.role === 'user' && m.text.trim() === HELLO_PROMPT) return false;
          const key = `${m.role}:${m.text}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setMessages(clean);
        setContext(ctx);
        setKickoffStarted(ks);
        setStatus('idle');
      })
      .catch((e: unknown) => {
        if (!aliveRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      });
    return () => {
      aliveRef.current = false;
    };
  }, [token, taskId, role, active]);

  /** Poll one run to completion. Returns 'done', or 'parked' with gates. */
  const pollRun = useCallback(
    async (runId: string, fromCursor: number): Promise<{ outcome: 'done' | 'parked' | 'abandoned'; full: string }> => {
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let cursor = fromCursor;
      let full = '';
      for (;;) {
        if (!aliveRef.current) return { outcome: 'abandoned', full };
        if (Date.now() > deadline) throw new Error('reply timed out — the run may still finish; check back soon.');
        const p = await pollCrewChat(token!, taskId, role, runId, cursor);
        if (!aliveRef.current) return { outcome: 'abandoned', full };
        cursor = p.nextCursor;
        cursorRef.current = cursor;
        if (p.text) {
          full += p.text;
          setStreaming(full);
          setLastActivityAt(Date.now());
        }
        if (p.activity.length > 0) {
          setActivity((prev) => {
            const next = [...prev, ...p.activity.filter((a) => !prev.includes(a))];
            return next.slice(-8);
          });
          setLastActivityAt(Date.now());
        }
        if (p.toolCalls !== null && p.toolCalls !== undefined) setToolCalls(p.toolCalls);
        if (p.note) setNotice(p.note);
        // Parked on a gate: stop polling, surface resolvable cards.
        if (p.approval || p.done) {
          if (token) {
            const g = await getGates(token, taskId, role, runId).catch(() => null);
            if (!aliveRef.current) return { outcome: 'abandoned', full };
            const hasGates = !!g && (g.approvals.length > 0 || g.questions.length > 0 || g.botRequests.length > 0);
            if (hasGates && g) {
              // Approval id may only be known from the poll event — merge it in.
              const approvals =
                g.approvals.length > 0
                  ? g.approvals
                  : p.approval
                    ? [{ id: p.approval.approvalId, permission: p.approval.permission, target: p.approval.target, requestedAt: '' }]
                    : [];
              setGates({ approvals, questions: g.questions, botRequests: g.botRequests });
              return { outcome: 'parked', full };
            }
          }
          if (p.done) break;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      return { outcome: 'done', full };
    },
    [token, taskId, role],
  );

  const send = useCallback(
    async (text: string, opts?: CrewSendOpts) => {
      const v = text.trim();
      if (!v || !token || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setNotice(null);
    setGates(null);
    setActivity([]);
    setToolCalls(null);
      const at = new Date().toISOString();
      if (!opts?.hello) setMessages((prev) => [...prev, { role: 'user', text: v, at }]);
      setStreaming('');
      setStatus('streaming');
      try {
        const started = await startCrewChat(token, taskId, role, v, opts ?? undefined);
        if (!aliveRef.current) return;
        if ('booting' in started) {
          throw new Error('Sandbox is booting — try again in a minute.');
        }
        runIdRef.current = started.runId;
        cursorRef.current = 0;
        const t0 = Date.now();
        setRunStartedAt(t0);
        setLastActivityAt(t0);
        const { outcome, full } = await pollRun(started.runId, 0);
        if (!aliveRef.current) return;
        if (outcome === 'parked') {
          setStreaming('');
          setStatus('blocked');
          busyRef.current = false;
          return;
        }
        setMessages((prev) => [...prev, { role: 'assistant', text: full || '(empty reply)', at: new Date().toISOString() }]);
        setStreaming('');
        setRunStartedAt(null);
        setStatus('idle');
        busyRef.current = false;
      } catch (e: unknown) {
        if (!aliveRef.current) return;
        if (!opts?.hello) setMessages((prev) => prev.slice(0, -1));
        setStreaming('');
        setRunStartedAt(null);
        // Hello runs fail silently — the static empty-state card stays.
        if (!opts?.hello) setError(e instanceof Error ? e.message : String(e));
        setStatus(opts?.hello ? 'idle' : 'error');
      } finally {
        busyRef.current = false;
      }
    },
    [token, taskId, role, pollRun],
  );

  /** Resolve one gate, then resume polling the same parked run. */
  const resolveGate = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      if (!token || !runIdRef.current || busyRef.current) return false;
      busyRef.current = true;
      setError(null);
      setGates(null);
      try {
        await fn();
        console.debug('[crew-chat] gate resolved, resuming run', runIdRef.current);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not resolve that.');
        busyRef.current = false;
        return false;
      }
      setGates(null);
      setStatus('streaming');
      try {
        const { outcome, full } = await pollRun(runIdRef.current, cursorRef.current);
        if (!aliveRef.current) return false;
        if (outcome === 'parked') {
          setStreaming('');
          setStatus('blocked');
          busyRef.current = false;
          return true;
        }
        setMessages((prev) => [...prev, { role: 'assistant', text: full || '(empty reply)', at: new Date().toISOString() }]);
        setStreaming('');
        setRunStartedAt(null);
        setStatus('idle');
        busyRef.current = false;
        return true;
      } catch (e: unknown) {
        if (!aliveRef.current) return false;
        setStreaming('');
        setRunStartedAt(null);
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      } finally {
        busyRef.current = false;
      }
      return false;
    },
    [token, pollRun],
  );

  const resolveApprovalGate = useCallback(
    (id: string, decision: 'approve' | 'reject' | 'approve-all') =>
      resolveGate(() => resolveApproval(token!, id, decision)),
    [token, resolveGate],
  );

  const answerQuestionGate = useCallback(
    (id: string, answers: string[][]) => resolveGate(() => answerQuestions(token!, id, answers)),
    [token, resolveGate],
  );

  const answerBotRequestGate = useCallback(
    (id: string, decision: 'confirm' | 'cancel') => resolveGate(() => answerBotRequest(token!, id, decision)),
    [token, resolveGate],
  );

  // Greeting: the bot speaks first on a never-touched thread (swarm parity).
  // Fix B: gate on backend truth (kickoffStarted), not on an empty screen.
  // History can read empty while a kickoff is in flight (revisit, remount,
  // VM rebirth) — greeting then would duplicate it. A started kickoff shows
  // "crew starting…" instead; the greeting is a rare fallback for threads
  // where no run ever started. Exactly-once per thread, silent on expiry.
  useEffect(() => {
    if (!token || !active || !taskId || status !== 'idle' || messages.length > 0 || kickoffStarted) return;
    const key = `${taskId}#${role}`;
    if (greetKeyRef.current === key) return;
    greetKeyRef.current = key;
    console.debug(`[crew-chat] greeting ${key}`);
    void send(HELLO_PROMPT, { hello: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, active, taskId, role, status, messages.length, kickoffStarted]);

  const clear = useCallback(async (): Promise<boolean> => {
    if (!token || busyRef.current) return false;
    busyRef.current = true;
    setError(null);
    try {
      const out = await clearCrewContext(token, taskId, role);
      if (!aliveRef.current) return false;
      setContext((ctx) =>
        ctx ? { ...ctx, tokens: out.tokens, limit: out.limit, pct: out.pct } : ctx,
      );
      setNotice('Context cleared — fresh session. The transcript above stays readable.');
      return true;
    } catch (e: unknown) {
      if (!aliveRef.current) return false;
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [token, taskId, role]);

  return {
    messages,
    streaming,
    status,
    error,
    notice,
    context,
    kickoffStarted,
    gates,
    activity,
    toolCalls,
    runStartedAt,
    lastActivityAt,
    send,
    clear,
    resolveApprovalGate,
    answerQuestionGate,
    answerBotRequestGate,
  };
}
