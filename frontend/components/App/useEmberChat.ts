'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EMBER_WS_URL, getChatHistory, type ChatMessage, type ContextStats } from '@/lib/ember';

export type EmberStatus = 'idle' | 'loading' | 'connecting' | 'streaming' | 'error';

interface WsIncoming {
  type: 'start' | 'token' | 'done' | 'error';
  text?: string;
  error?: string;
  context?: ContextStats;
}

/**
 * Streaming Ember chat over the protected WebSocket (JWT in ?token=).
 * History loads once via REST; new turns stream token-by-token.
 */
export function useEmberChat(token: string | null, assistantId: string, active: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [status, setStatus] = useState<EmberStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<ContextStats | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retried = useRef(false);

  // Initial transcript (+ context seeding).
  useEffect(() => {
    if (!token || !active) return;
    let alive = true;
    setStatus('loading');
    getChatHistory(token, assistantId)
      .then(({ messages: msgs, context: ctx }) => {
        if (alive) {
          setMessages(msgs);
          setContext(ctx);
          setStatus('idle');
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
      });
    return () => {
      alive = false;
    };
  }, [token, assistantId, active]);

  // Socket teardown when leaving.
  useEffect(() => {
    if (!active) {
      wsRef.current?.close();
      wsRef.current = null;
    }
  }, [active ]);

  const ensureSocket = useCallback((): Promise<WebSocket> => {
    const open = wsRef.current;
    if (open && open.readyState === WebSocket.OPEN) return Promise.resolve(open);
    if (!token) return Promise.reject(new Error('Sign in first'));
    if (!EMBER_WS_URL) return Promise.reject(new Error('Chat endpoint not configured'));
    return new Promise((resolve, reject) => {
      setStatus('connecting');
      const ws = new WebSocket(`${EMBER_WS_URL}?token=${encodeURIComponent(token)}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('chat connection timed out'));
      }, 15000);
      ws.onopen = () => {
        clearTimeout(timer);
        wsRef.current = ws;
        resolve(ws);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('chat connection failed'));
      };
    });
  }, [token]);

  const send = useCallback(
    async (text: string) => {
      const v = text.trim();
      if (!v || status === 'streaming') return;
      setError(null);
      const at = new Date().toISOString();
      setMessages((prev) => [...prev, { role: 'user', text: v, at }]);
      setStreaming('');
      try {
        const ws = await ensureSocket();
        setStatus('streaming');
        await new Promise<void>((resolve, reject) => {
          let full = '';
          const timer = setTimeout(() => reject(new Error('reply timed out')), 90000);
          ws.onmessage = (ev) => {
            let msg: WsIncoming;
            try {
              msg = JSON.parse(ev.data as string);
            } catch {
              return;
            }
            if (msg.type === 'token') {
              full += msg.text ?? '';
              setStreaming(full);
            } else if (msg.type === 'done') {
              clearTimeout(timer);
              setMessages((prev) => [...prev, { role: 'assistant', text: full, at: new Date().toISOString() }]);
              if (msg.context) setContext(msg.context);
              setStreaming('');
              setStatus('idle');
              resolve();
            } else if (msg.type === 'error') {
              clearTimeout(timer);
              reject(new Error(msg.error ?? 'chat failed'));
            }
          };
          ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error('chat connection dropped'));
          };
          ws.send(JSON.stringify({ action: 'chat', assistantId, message: v }));
        });
        retried.current = false;
      } catch (e: unknown) {
        // One transparent reconnect, then surface the error.
        wsRef.current = null;
        if (!retried.current) {
          retried.current = true;
          setMessages((prev) => prev.slice(0, -1));
          return send(v);
        }
        setMessages((prev) => prev.slice(0, -1));
        setStreaming('');
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    },
    [assistantId, ensureSocket, status],
  );

  return { messages, streaming, status, error, context, send };
}
