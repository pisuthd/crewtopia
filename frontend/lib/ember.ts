'use client';

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') ?? '';
export const EMBER_WS_URL =
  process.env.NEXT_PUBLIC_EMBER_WS_URL?.replace(/\/+$/, '') ?? '';

export interface Assistant {
  id: string;
  name: string;
  role: string;
  description: string;
  price: string;
  color: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

export interface ContextStats {
  tokens: number;
  limit: number;
  /** Percent of limit used, one decimal. */
  pct: number;
  model: string;
}

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
  return body as Record<string, unknown>;
}

export async function getAssistants(): Promise<Assistant[]> {
  const res = await fetch(`${API}/assistants`);
  if (!res.ok) throw new Error(`catalog failed (${res.status})`);
  const body = (await res.json()) as { assistants: Assistant[] };
  return body.assistants;
}

export async function assignAssistant(token: string, assistantId: string): Promise<void> {
  await api('/assistants/assign', token, {
    method: 'POST',
    body: JSON.stringify({ assistantId }),
  });
}

export async function getChatHistory(
  token: string,
  assistantId: string,
): Promise<{ messages: ChatMessage[]; context: ContextStats | null }> {
  const body = await api(`/chat/history?assistantId=${encodeURIComponent(assistantId)}`, token);
  return { messages: body.messages as ChatMessage[], context: (body.context as ContextStats) ?? null };
}
