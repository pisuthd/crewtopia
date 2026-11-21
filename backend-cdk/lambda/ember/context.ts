import type { ChatMessage } from './store';

/** Token estimate heuristic (opencode's CHARS_PER_TOKEN — no tokenizer dependency). */
const CHARS_PER_TOKEN = 4;

export interface ContextStats {
  tokens: number;
  limit: number;
  /** Percent of limit used, one decimal. */
  pct: number;
  model: string;
}

export function modelContextLimit(): number {
  const raw = Number(process.env.PROVIDER_CONTEXT_LIMIT ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 1_048_576;
}

/** Context usage for a transcript. Unknown/empty reads zero. */
export function contextFor(messages: ChatMessage[]): ContextStats {
  const tokens = Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN);
  const limit = modelContextLimit();
  return {
    tokens,
    limit,
    pct: limit > 0 ? Math.round((tokens / limit) * 1000) / 10 : 0,
    model: process.env.PROVIDER_MODEL ?? '',
  };
}
