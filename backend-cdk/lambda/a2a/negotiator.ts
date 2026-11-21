import type { Quote } from '../pricelist';
import type { TaskMessage } from './types';

/**
 * Negotiator brain: small-model PM reply over an OpenAI-compatible endpoint.
 * Returns null when unconfigured or on any failure — the caller falls back
 * to the template PM, so negotiation never hard-depends on inference.
 */
export async function modelReply(history: TaskMessage[], quote: Quote): Promise<string | null> {
  const base = (process.env.NEGOTIATOR_BASE_URL ?? '').replace(/\/+$/, '');
  const key = process.env.NEGOTIATOR_API_KEY ?? '';
  const model = process.env.NEGOTIATOR_MODEL ?? '';
  if (!base || !key || !model) return null;
  try {
    const items = quote.roles.map((r) => `- ${r}`).join('\n');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content:
              `You are the PM of ${quote.displayName}, a dev team for hire on BNB Chain. ` +
              `You rent the WHOLE team flat at ${quote.rateUPerHour} U/hour, billed in ${quote.chunkSeconds / 60}-min chunks ` +
              `(whole team, roles:\n${items}). This quote: ${quote.chunks} chunk(s) = ~${Math.round(quote.fundedSeconds / 60)} min for ${quote.totalU} U total. ` +
              `Escrow: ERC-8183, 900s dispute window. Buyer renews with the same contextId to continue, stops by not renewing. ` +
              `If the brief is vague, ask crisp clarifying questions (scope, minutes needed, budget cap). ` +
              `Keep replies under 120 words. Never invent prices off the rental rate; never claim work is done.`,
          },
          ...history.slice(-8).map((m) => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.text })),
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const text = json?.choices?.[0]?.message?.content?.trim();
    return text ? String(text).slice(0, 1000) : null;
  } catch {
    return null;
  }
}
