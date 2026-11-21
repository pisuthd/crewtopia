'use client';

import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import Hexbot, { type HexbotColor, type HexbotRole } from '../Hexbot';
import { useSession } from './SessionContext';
import { useMemberChat } from './useMemberChat';
import Markdown from './Markdown';
import type { ContextStats } from '@/lib/ember';

interface MemberChatProps {
  taskId: string;
  role: string;
  name: string;
  title: string;
  color: HexbotColor;
  hexRole: HexbotRole;
  description: string;
  onModel?: (model: string | null) => void;
}

function ctxTone(pct: number): string {
  if (pct >= 90) return 'bg-red-50 text-red-600';
  if (pct >= 70) return 'bg-amber-50 text-amber-700';
  return 'bg-wfice text-wfink';
}

/** Direct thread with one crew member — same thread UI as Ember, VM-backed. */
export default function MemberChat({ taskId, role, name, title, color, hexRole, description, onModel }: MemberChatProps) {
  const { token } = useSession();
  const { messages, streaming, status, error, context, send } = useMemberChat(token, taskId, role, true);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onModel?.(context?.model ?? null);
  }, [context?.model, onModel]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const busy = status === 'streaming' || status === 'connecting' || status === 'loading';
  const submit = () => {
    if (!draft.trim() || busy) return;
    void send(draft);
    setDraft('');
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 text-[15px]">
        {(status === 'loading' || (status === 'connecting' && !streaming)) && (
          <div className="w-fit rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm">
            <span className="typing-dots flex gap-1">
              <i className="h-2 w-2 rounded-full bg-slate-400" />
              <i className="h-2 w-2 rounded-full bg-slate-400" />
              <i className="h-2 w-2 rounded-full bg-slate-400" />
            </span>
          </div>
        )}
        {messages.length === 0 && status === 'idle' && (
          <div className="mx-auto max-w-sm py-8 text-center">
            <div className="mx-auto mb-4 w-fit">
              <Hexbot color={color} size="md" role={hexRole} label={`${name} hexbot`} />
            </div>
            <p className="font-brico text-xl font-bold text-wfnavy">Talk to {name}</p>
            <p className="mt-1 text-sm text-wfink">{title} — {description}</p>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-wfnavy px-4 py-2.5 text-sm text-white">
              {m.text}
            </div>
          ) : (
            <div key={i} className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-sm text-wfnavy shadow-sm">
              <Markdown text={m.text} />
            </div>
          ),
        )}
        {(streaming || (busy && status === 'streaming')) && (
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-sm text-wfnavy shadow-sm">
            <Markdown text={streaming} />
            <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-wfcta" />
          </div>
        )}
        {error && <p className="text-center text-xs text-red-600">{error}</p>}
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
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white p-1.5 shadow-sm focus-within:border-wfcta">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={`Message ${name}…`}
                disabled={busy}
                className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-wfnavy outline-none placeholder:text-wfink/60 disabled:opacity-50"
              />
              <button
                onClick={submit}
                disabled={busy || !draft.trim()}
                aria-label="Send"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-wfnavy text-white hover:opacity-90 disabled:opacity-30"
              >
                <Send className="h-[18px] w-[18px]" strokeWidth={2.4} />
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between px-1">
              <span />
              {context ? (
                <span
                  title={`${context.tokens} of ${context.limit} tokens`}
                  className={`flex h-7 shrink-0 items-center rounded-full px-2.5 text-[11px] font-bold ${ctxTone(context.pct)}`}
                >
                  <span className="tabular-nums">{`${context.tokens} (${context.pct}%)`}</span>
                </span>
              ) : (
                <span />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
