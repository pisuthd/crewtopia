'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronUp, Loader2, Mic, Paperclip, Send, X } from 'lucide-react';
import Hexbot, { type HexbotColor, type HexbotRole } from '../Hexbot';
import { useSession } from './SessionContext';
import { useCrewChat } from './useCrewChat';
import Markdown from './Markdown';
import VoiceModal from './VoiceModal';
import {
  compactCrewContext,
  getProviders,
  uploadSandboxFile,
  type PendingApproval,
  type PendingBotRequest,
  type PendingQuestion,
} from '@/lib/api';

interface MemberChatProps {
  taskId: string;
  role: string;
  name: string;
  title: string;
  color: HexbotColor;
  hexRole: HexbotRole;
  description: string;
  onModel?: (model: string | null) => void;
  onFundMore: () => void;
  roster?: { role: string; name: string; title: string }[];
}

interface StagedFile {
  name: string;
  path: string;
  size: number;
}

interface ModelPick {
  provider: string;
  model: string;
}

/** Friendly display names — raw catalog ids (muse-ember-1.0) mean nothing. */
const MODEL_NAMES: Record<string, string> = {
  'muse-ember-1.0': 'Muse Ember',
  'muse-spark-1.3-contributor': 'Muse Spark',
};

function friendlyModel(id: string): string {
  const known = MODEL_NAMES[id] ?? MODEL_NAMES[id.split('/').pop() ?? ''];
  if (known) return known;
  return (id.split('/').pop() ?? id)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const MAX_ATTACH = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function ctxTone(pct: number): string {
  if (pct >= 90) return 'bg-red-50 text-red-600';
  if (pct >= 70) return 'bg-amber-50 text-amber-700';
  return 'bg-wfice text-wfink';
}

function fmtDur(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function ApprovalCard({ gate, resolving, onResolve }: {
  gate: PendingApproval;
  resolving: boolean;
  onResolve: (decision: 'approve' | 'reject' | 'approve-all') => void;
}) {
  return (
    <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-amber-300 bg-white px-4 py-3 text-sm text-wfnavy shadow-sm">
      <p className="font-brico font-bold text-amber-700">Approval needed</p>
      <p className="mt-1 break-words font-mono text-xs">
        {gate.permission}
        {gate.target ? `: ${gate.target}` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          onClick={() => onResolve('approve')}
          disabled={resolving}
          className="rounded-full bg-wfnavy px-4 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {resolving ? 'Working…' : 'Approve'}
        </button>
        {gate.permission === 'shell' && (
          <button
            onClick={() => onResolve('approve-all')}
            disabled={resolving}
            title="Allow all shell commands for the rest of this run"
            className="rounded-full bg-wfice px-4 py-1.5 text-xs font-bold text-wfnavy hover:bg-slate-200 disabled:opacity-50"
          >
            Approve all shell
          </button>
        )}
        <button
          onClick={() => onResolve('reject')}
          disabled={resolving}
          className="rounded-full bg-wfice px-4 py-1.5 text-xs font-bold text-wfink hover:bg-slate-200 disabled:opacity-50"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

function QuestionCard({ gate, resolving, onAnswer }: {
  gate: PendingQuestion;
  resolving: boolean;
  onAnswer: (answers: string[][]) => void;
}) {
  const [sel, setSel] = useState<Record<number, string | null>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [otherOn, setOtherOn] = useState<Record<number, boolean>>({});
  const send = () => {
    onAnswer(
      gate.questions.map((_, i) =>
        (custom[i] ?? '').trim() ? [(custom[i] as string).trim()] : sel[i] ? [sel[i] as string] : [],
      ),
    );
  };
  return (
    <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-wfcta/40 bg-white px-4 py-3 text-sm text-wfnavy shadow-sm">
      <p className="font-brico font-bold text-wfnavy">Question</p>
      {gate.questions.map((q, i) => (
        <div key={i} className="mt-2 border-t border-wfnavy/10 pt-2 first:border-0 first:pt-0">
          {q.header && <p className="text-[11px] font-bold uppercase tracking-wide text-wfink">{q.header}</p>}
          <p className="mt-0.5 font-semibold">{q.question}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {q.options.map((o) => (
              <button
                key={o.label}
                disabled={resolving}
                title={o.description || undefined}
                onClick={() => {
                  setSel((prev) => ({ ...prev, [i]: prev[i] === o.label ? null : o.label }));
                  setCustom((prev) => ({ ...prev, [i]: '' }));
                }}
                className={`rounded-full px-3 py-1 text-xs font-bold transition disabled:opacity-50 ${
                  sel[i] === o.label ? 'bg-wfnavy text-white' : 'bg-wfice text-wfnavy hover:bg-slate-200'
                }`}
              >
                {o.label}
              </button>
            ))}
            <button
              disabled={resolving}
              onClick={() => {
                setOtherOn((prev) => ({ ...prev, [i]: !prev[i] }));
                setSel((prev) => ({ ...prev, [i]: null }));
              }}
              className={`rounded-full px-3 py-1 text-xs font-bold transition disabled:opacity-50 ${
                otherOn[i] ? 'bg-wfnavy text-white' : 'bg-wfice text-wfink hover:bg-slate-200'
              }`}
            >
              Other…
            </button>
            <button
              disabled={resolving}
              onClick={() => {
                setSel((prev) => ({ ...prev, [i]: null }));
                setCustom((prev) => ({ ...prev, [i]: '' }));
                setOtherOn((prev) => ({ ...prev, [i]: false }));
              }}
              className="rounded-full px-3 py-1 text-xs font-bold text-wfink hover:bg-slate-100 disabled:opacity-50"
            >
              Skip
            </button>
          </div>
          {otherOn[i] && (
            <input
              value={custom[i] ?? ''}
              disabled={resolving}
              onChange={(e) => setCustom((prev) => ({ ...prev, [i]: e.target.value.slice(0, 500) }))}
              placeholder="Type your own answer…"
              className="mt-1.5 w-full rounded-xl border border-wfnavy/10 bg-white px-3 py-2 text-sm text-wfnavy outline-none focus:border-wfcta disabled:opacity-50"
            />
          )}
        </div>
      ))}
      <button
        onClick={send}
        disabled={resolving}
        className="mt-3 w-full rounded-full bg-wfnavy py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
      >
        {resolving ? 'Sending…' : 'Send answers'}
      </button>
    </div>
  );
}

function RunClock({ startedAt, lastActivityAt, now, toolCalls }: {
  startedAt: number;
  lastActivityAt: number | null;
  now: number;
  toolCalls?: number | null;
}) {
  const elapsedS = Math.max(0, Math.round((now - startedAt) / 1000));
  const gapS = lastActivityAt !== null ? Math.round((now - lastActivityAt) / 1000) : 0;
  const stalled = gapS >= 15;
  return (
    <p className={`mt-1.5 text-[11px] font-bold tabular-nums ${stalled ? 'text-amber-600' : 'text-wfink'}`}>
      working · {fmtDur(elapsedS)}
      {toolCalls !== null && toolCalls !== undefined ? ` · ${toolCalls} tools` : ''}
      {stalled ? ` · last update ${gapS}s ago` : ''}
    </p>
  );
}

function BotRequestCard({ gate, resolving, onDecide }: {
  gate: PendingBotRequest;
  resolving: boolean;
  onDecide: (decision: 'confirm' | 'cancel') => void;
}) {
  return (
    <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-wfcta/40 bg-white px-4 py-3 text-sm text-wfnavy shadow-sm">
      <p className="font-brico font-bold text-wfnavy">
        {gate.kind === 'update' ? 'Update bot?' : 'New bot?'}
      </p>
      <p className="mt-1 font-semibold">
        {gate.name || 'Unnamed bot'}
        {gate.role ? <span className="font-mono text-xs text-wfink"> · {gate.role}</span> : null}
      </p>
      {gate.description && <p className="mt-1 text-xs text-wfink">{gate.description}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          onClick={() => onDecide('confirm')}
          disabled={resolving}
          className="rounded-full bg-wfnavy px-4 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {resolving ? 'Working…' : gate.kind === 'update' ? 'Apply update' : 'Create bot'}
        </button>
        <button
          onClick={() => onDecide('cancel')}
          disabled={resolving}
          className="rounded-full bg-wfice px-4 py-1.5 text-xs font-bold text-wfink hover:bg-slate-200 disabled:opacity-50"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

/** Direct thread with one crew member — VM-backed. */
export default function MemberChat({ taskId, role, name, title, color, hexRole, description, onModel, onFundMore, roster = [] }: MemberChatProps) {
  const { token } = useSession();
  const {
    messages, streaming, status, error, notice, context, kickoffStarted,
    gates, activity, toolCalls, runStartedAt, lastActivityAt, send, clear,
    resolveApprovalGate, answerQuestionGate, answerBotRequestGate,
  } = useCrewChat(token, taskId, role, true);
  const [draft, setDraft] = useState('');
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [providers, setProviders] = useState<ModelPick[]>([]);
  const [threadDefault, setThreadDefault] = useState<ModelPick | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [pick, setPick] = useState<ModelPick | null>(() => {
    try {
      const raw = localStorage.getItem(`crew-model:${taskId}:${role}`);
      return raw ? (JSON.parse(raw) as ModelPick) : null;
    } catch {
      return null;
    }
  });
  const [clearing, setClearing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [resolving, setResolving] = useState<string | null>(null);
  const [compactNote, setCompactNote] = useState<string | null>(null);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [resolvedNote, setResolvedNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Elapsed-run ticker: drives the working-Ns pill while streaming.
  useEffect(() => {
    if (status !== 'streaming' || !runStartedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status, runStartedAt]);

  useEffect(() => {
    onModel?.(context?.model ?? null);
  }, [context?.model, onModel]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => {
    if (!token) return;
    getProviders(token, taskId, role)
      .then((p) => {
        setProviders(p.models);
        setThreadDefault(p.threadDefault.model ? p.threadDefault : null);
      })
      .catch(() => {});
  }, [token, taskId, role]);

  const busy = status === 'streaming' || status === 'sending' || status === 'loading' || status === 'blocked';
  const [compacting, setCompacting] = useState(false);
  const sendWithPick = (text: string, extra?: { attachments?: string[] }) => {
    void send(text, {
      ...(extra?.attachments?.length ? { attachments: extra.attachments } : {}),
      ...(pick ? { provider: pick.provider, model: pick.model } : {}),
    });
  };
  const submit = () => {
    if ((!draft.trim() && staged.length === 0) || busy || uploading || voiceOpen) return;
    setCompactNote(null);
    setCompactError(null);
    if (draft.trim() === '/compact') {
      void doCompact();
      return;
    }
    const text = draft.trim() || staged.map((s) => `[attached: ${s.path}]`).join('\n');
    sendWithPick(text, staged.length > 0 ? { attachments: staged.map((s) => s.path) } : undefined);
    setDraft('');
    setStaged([]);
  };
  const voiceSend = (text: string) => {
    if (busy) return;
    sendWithPick(text);
  };

  const mentionOptions = (mentionQuery === null ? [] : roster
    .filter((m) => `${m.name} ${m.title} ${m.role}`.toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, 6));

  const handleDraftChange = (value: string) => {
    setDraft(value);
    setCompactNote(null);
    setCompactError(null);
    const pos = inputRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const m = /@(\w*)$/.exec(before);
    setMentionQuery(m ? m[1] : null);
    setMentionIndex(0);
  };

  const pickMention = (memberName: string) => {
    const el = inputRef.current;
    const value = draft;
    const pos = el?.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const m = /@(\w*)$/.exec(before);
    if (!m) return;
    const next = `${before.slice(0, m.index)}@${memberName} ${value.slice(pos)}`;
    setDraft(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      const caret = m.index + memberName.length + 2;
      el?.setSelectionRange(caret, caret);
    });
  };


  const doCompact = async () => {
    if (!token || compacting || busy) return;
    setCompacting(true);
    setCompactError(null);
    setCompactNote(null);
    try {
      const out = await compactCrewContext(token, taskId, role);
      setCompactNote(out.note || `Context compacted \u2014 ${out.tokens} tokens (${out.pct}%).`);
      onModel?.(null);
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : 'Compact failed.');
    } finally {
      setCompacting(false);
      setDraft('');
    }
  };

  const doGate = async (key: string, fn: () => Promise<boolean>, label: string) => {
    if (resolving) return;
    setResolving(key);
    try {
      const ok = await fn();
      if (ok) setResolvedNote(`\u2713 ${label} \u2014 crew continuing\u2026`);
    } finally {
      setResolving(null);
    }
  };


  const pickFiles = async (files: FileList | null) => {
    if (!files || !token || uploading) return;
    setAttachError(null);
    const room = MAX_ATTACH - staged.length;
    const list = [...files].slice(0, Math.max(0, room));
    if (list.length === 0) {
      setAttachError(`At most ${MAX_ATTACH} files per message.`);
      return;
    }
    setUploading(true);
    try {
      for (const f of list) {
        if (f.size > MAX_FILE_BYTES) {
          setAttachError(`'${f.name}' is over 10MB — skipped.`);
          continue;
        }
        const safe = f.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 60) || 'file';
        const path = `attachments/${Date.now()}-${safe}`;
        const buf = await f.arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        const size = await uploadSandboxFile(token, path, btoa(bin));
        console.debug(`[crew-chat] staged ${path} (${size}B)`);
        setStaged((prev) => [...prev, { name: f.name, path, size }]);
      }
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const chooseModel = (m: ModelPick | null) => {
    setPick(m);
    try {
      if (m) localStorage.setItem(`crew-model:${taskId}:${role}`, JSON.stringify(m));
      else localStorage.removeItem(`crew-model:${taskId}:${role}`);
    } catch { /* private mode */ }
    setModelOpen(false);
  };

  const clearCtx = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await clear();
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 text-[15px]">
        {status === 'loading' && (
          <div className="w-fit rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm">
            <span className="typing-dots flex gap-1">
              <i className="h-2 w-2 rounded-full bg-slate-400" />
              <i className="h-2 w-2 rounded-full bg-slate-400" />
              <i className="h-2 w-2 rounded-full bg-slate-400" />
            </span>
          </div>
        )}
        {messages.length === 0 && status === 'idle' && kickoffStarted && (
          <div className="mx-auto max-w-sm py-8 text-center">
            <div className="mx-auto mb-4 w-fit">
              <Hexbot color={color} size="md" role={hexRole} label={`${name} hexbot`} />
            </div>
            <p className="font-brico text-xl font-bold text-wfnavy">{name} is starting…</p>
            <p className="mt-1 text-sm text-wfink">The crew kickoff is running — their hello lands here in a minute.</p>
          </div>
        )}
        {messages.length === 0 && status === 'idle' && !kickoffStarted && (
          <div className="mx-auto max-w-sm py-8 text-center">
            <div className="mx-auto mb-4 w-fit">
              <Hexbot color={color} size="md" role={hexRole} label={`${name} hexbot`} />
            </div>
            <p className="font-brico text-xl font-bold text-wfnavy">Talk to {name}</p>
            <p className="mt-1 text-sm text-wfink">{title} — {description}</p>
            <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs text-wfink shadow-sm">
              Direct line — the crew coordinates internally through {roster[0]?.name ?? 'its lead'}, so nothing shows here until you message {name} yourself.
            </p>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} title={m.at ? new Date(m.at).toLocaleString() : undefined} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-wfnavy px-4 py-2.5 text-sm text-white">
              {m.text}
            </div>
          ) : (
            <div key={i} title={m.at ? new Date(m.at).toLocaleString() : undefined} className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-sm text-wfnavy shadow-sm">
              <Markdown text={m.text} />
            </div>
          ),
        )}
        {(streaming || (busy && status === 'streaming')) && (
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-sm text-wfnavy shadow-sm">
            <Markdown text={streaming} />
            <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-wfcta" />
            {activity.length > 0 && (
              <div className="mt-1.5 space-y-0.5 border-t border-wfnavy/10 pt-1.5">
                {activity.map((t, i) => (
                  <p key={i} className="truncate text-[11px] text-wfink">
                    <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-wfcta" />
                    {t}
                  </p>
                ))}
              </div>
            )}
            {runStartedAt !== null && (
              <RunClock startedAt={runStartedAt} lastActivityAt={lastActivityAt} now={now} toolCalls={toolCalls} />
            )}
          </div>
        )}
        {gates && (gates.approvals.length > 0 || gates.questions.length > 0 || gates.botRequests.length > 0) && (
          <div className="flex flex-col gap-3">
            {gates.approvals.map((g) => (
              <ApprovalCard
                key={`a:${g.id}`}
                gate={g}
                resolving={resolving === `a:${g.id}`}
                onResolve={(d) => void doGate(`a:${g.id}`, () => resolveApprovalGate(g.id, d), 'Approved')}
              />
            ))}
            {gates.questions.map((g) => (
              <QuestionCard
                key={`q:${g.id}`}
                gate={g}
                resolving={resolving === `q:${g.id}`}
                onAnswer={(answers) => void doGate(`q:${g.id}`, () => answerQuestionGate(g.id, answers), 'Answered')}
              />
            ))}
            {gates.botRequests.map((g) => (
              <BotRequestCard
                key={`b:${g.id}`}
                gate={g}
                resolving={resolving === `b:${g.id}`}
                onDecide={(d) => void doGate(`b:${g.id}`, () => answerBotRequestGate(g.id, d), d === 'confirm' ? 'Bot request confirmed' : 'Declined')}
              />
            ))}
          </div>
        )}
        {(compactNote || compactError) && (
          <p className={`mx-auto max-w-[85%] rounded-xl px-4 py-2 text-center text-xs font-semibold ${compactError ? 'bg-red-50 text-red-600' : 'bg-wfice text-wfnavy'}`}>
            {compactError ?? compactNote}
          </p>
        )}
        {resolvedNote && (
          <p className="mx-auto max-w-[85%] rounded-xl bg-emerald-50 px-4 py-2 text-center text-xs font-semibold text-emerald-700">
            {resolvedNote}
          </p>
        )}
        {error && (
          <div className="text-center">
            <p className="text-xs text-red-600">{error}</p>
            {/rental window ended|fund more|extend/i.test(error) && (
              <button
                onClick={onFundMore}
                className="mt-2 rounded-full bg-wfnavy px-4 py-2 text-xs font-bold text-white hover:opacity-90"
              >
                Extend rental
              </button>
            )}
          </div>
        )}
        {notice && <p className="mx-auto max-w-[85%] rounded-xl bg-amber-50 px-4 py-2 text-center text-xs text-amber-700">{notice}</p>}
        <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-4 pb-4">
        {!token ? (
          <p className="mx-auto max-w-2xl rounded-2xl border border-wfnavy/10 bg-white px-4 py-3 text-center text-sm text-wfink">
            Connect a wallet and sign in to chat with {name}.
          </p>
        ) : (
          <div className="mx-auto max-w-2xl">
            {staged.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {staged.map((s) => (
                  <span key={s.path} className="flex items-center gap-1.5 rounded-full bg-wfice py-1 pl-3 pr-1.5 text-xs font-semibold text-wfnavy">
                    <span className="max-w-40 truncate">{s.name}</span>
                    <button
                      onClick={() => setStaged((prev) => prev.filter((x) => x.path !== s.path))}
                      aria-label={`Remove ${s.name}`}
                      className="grid h-5 w-5 place-items-center rounded-full hover:bg-slate-200"
                    >
                      <X className="h-3 w-3" strokeWidth={2.5} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm focus-within:border-wfcta">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  void pickFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy || uploading || staged.length >= MAX_ATTACH}
                aria-label="Attach a file"
                title="Attach images or PDFs to the sandbox (10MB each, 5 max)"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-wfnavy hover:bg-slate-100 disabled:opacity-30"
              >
                {uploading ? <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2.4} /> : <Paperclip className="h-[18px] w-[18px]" strokeWidth={2.4} />}
              </button>
              <button
                onClick={() => setVoiceOpen(true)}
                disabled={busy || uploading}
                aria-label="Voice message"
                title="Speak instead of typing"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-wfnavy hover:bg-slate-100 disabled:opacity-30"
              >
                <Mic className="h-[18px] w-[18px]" strokeWidth={2.4} />
              </button>
              <div className="relative min-w-0 flex-1">
                {mentionQuery !== null && mentionOptions.length > 0 && (
                  <div className="absolute bottom-12 left-0 z-40 max-h-48 w-64 overflow-y-auto rounded-xl border border-wfnavy/10 bg-white py-1 shadow-lg">
                    {mentionOptions.map((m, i) => (
                      <button
                        key={m.role}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickMention(m.name);
                        }}
                        onMouseEnter={() => setMentionIndex(i)}
                        className={`block w-full truncate px-3 py-1.5 text-left text-xs font-bold ${i === mentionIndex ? 'bg-wfice text-wfnavy' : 'text-wfink'}`}
                      >
                        @{m.name} <span className="font-medium">{m.title}</span>
                      </button>
                    ))}
                  </div>
                )}
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (mentionQuery !== null && mentionOptions.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setMentionIndex((i) => (i + 1) % mentionOptions.length);
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length);
                        return;
                      }
                      if (e.key === 'Tab' || e.key === 'Enter') {
                        e.preventDefault();
                        pickMention(mentionOptions[mentionIndex]?.name ?? mentionOptions[0].name);
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setMentionQuery(null);
                        return;
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={draft.trim() === '/compact' ? 'Compact this thread?' : `Message ${name}…`}
                  disabled={busy}
                  className="w-full min-w-0 bg-transparent px-2 text-[15px] text-wfnavy outline-none placeholder:text-wfink/60 disabled:opacity-50"
                />
              </div>
              <button
                onClick={submit}
                disabled={busy || uploading || voiceOpen || (!draft.trim() && staged.length === 0)}
                aria-label="Send"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-wfnavy text-white hover:opacity-90 disabled:opacity-30"
              >
                <Send className="h-[18px] w-[18px]" strokeWidth={2.4} />
              </button>
            </div>
            {attachError && (
              <p className="mt-1.5 px-1 text-xs text-red-600">{attachError}</p>
            )}
            <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
              <div className="relative">
                {(providers.length > 0 || threadDefault) && (
                  <>
                    <button
                      onClick={() => setModelOpen((o) => !o)}
                      aria-label="Pick a model"
                      title={pick ? `${pick.provider}/${pick.model}` : threadDefault ? `Default — ${threadDefault.provider}/${threadDefault.model} on this thread` : 'Default'}
                      className="flex h-7 items-center gap-1 rounded-full bg-wfice px-2.5 text-[11px] font-bold text-wfink hover:text-wfnavy"
                    >
                      <span className="max-w-36 truncate">{pick ? friendlyModel(pick.model) : 'Default'}</span>
                      <ChevronUp className={`h-3 w-3 transition-transform ${modelOpen ? '' : 'rotate-180'}`} strokeWidth={2.5} />
                    </button>
                    {modelOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setModelOpen(false)} />
                        <div className="absolute bottom-8 left-0 z-50 max-h-56 w-64 overflow-y-auto rounded-xl border border-wfnavy/10 bg-white py-1 shadow-lg">
                          <button
                            onClick={() => chooseModel(null)}
                            title={threadDefault ? `${threadDefault.provider}/${threadDefault.model}` : 'Catalog default'}
                            className={`block w-full px-3 py-1.5 text-left text-xs font-bold ${!pick ? 'bg-wfice text-wfnavy' : 'text-wfink hover:bg-slate-50'}`}
                          >
                            Default{threadDefault?.model ? ` (${friendlyModel(threadDefault.model)})` : ''}
                          </button>
                          {providers.map((m) => {
                            const active = pick?.provider === m.provider && pick?.model === m.model;
                            return (
                              <button
                                key={`${m.provider}/${m.model}`}
                                onClick={() => chooseModel(m)}
                                title={`${m.provider}/${m.model}`}
                                className={`block w-full truncate px-3 py-1.5 text-left text-xs font-bold ${active ? 'bg-wfice text-wfnavy' : 'text-wfink hover:bg-slate-50'}`}
                              >
                                {friendlyModel(m.model)}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {context ? (
                  <button
                    onClick={() => void clearCtx()}
                    disabled={clearing || busy}
                    title={`${context.tokens} of ${context.limit} tokens${context.model ? ` on ${context.model}` : ''} — click to clear the session (transcript stays)`}
                    aria-label={`Context ${context.pct}% used — click to clear`}
                    className={`flex h-7 shrink-0 items-center rounded-full px-2.5 text-[11px] font-bold disabled:opacity-50 ${ctxTone(context.pct)}`}
                  >
                    {clearing ? (
                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />
                    ) : (
                      <span className="tabular-nums">{`${context.tokens} (${context.pct}%)`}</span>
                    )}
                  </button>
                ) : (
                  <span />
                )}
              </div>
            </div>
          </div>
        )}
        {voiceOpen && (
          <VoiceModal token={token} onVoiceSend={voiceSend} onClose={() => setVoiceOpen(false)} />
        )}
      </div>
    </>
  );
}
