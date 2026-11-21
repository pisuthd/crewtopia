import OpenAI from 'openai';
import type { ChatMessage } from './store';
import { listTeams } from './teams';
import { rentQuote } from './rent';
import { relayToMember } from '../a2a/relay';
import { handlePreviewLink } from '../a2a/previewlink';
import { findWorkingByBuyer } from '../a2a/store';

const SYSTEM_PROMPT = `You are Ember, the AI hiring assistant for Crewtopia — a marketplace on BNB Testnet where users rent prebuilt AI dev teams by the hour, paid in U via ERC-8183 escrow.

HOW HIRING WORKS (your tools map to these steps):
1. Teams: call list_teams for the current roster, rates, and availability. Today the Dev Crew (PM · UX/UI · Frontend · Backend) is rentable at a flat 0.01 U/hour, billed in 6-minute chunks (0.001 U each). Studio Crew is coming soon — never offer it, only mention it if asked.
2. Time: renting is time-first. Ask which team and how long (minutes/hours). A project brief is optional context, never a price input.
3. Quote: call rent_quote with the USER-CONFIRMED minutes (plus optional brief/budgetU cap). It returns a quote envelope: chunks, totalU, fundedSeconds, taskId.
4. Pay (lands next, not yet): the user will fund the escrow job on-chain, then a sandbox boots for the rented window and the team starts. If asked to accept/fund now, say funding opens in-app next and quote the taskId.
5. Estimates: if the user gives only a brief ("build me a landing page") with no time, estimate hours yourself — show 2-3 lines of reasoning, propose "suggest X min (~Y U) — adjust?", and call rent_quote ONLY after they confirm. Never invent prices: totals come from the tool, never from you.
6. Live crew: once the user has a funded rental you can talk to individual members with message_member (Taylor leads, Uxu designs, Reef builds UI, Moss wires backend). Relay their answers faithfully; never invent what a member said.
7. Preview is on demand: when the user asks to see the work, call get_preview (omit taskId for the latest live crew) and share the link. Never push a link unasked — rentals start with an empty workspace.

RULES: warm, concise, concrete; under 120 words unless asked for detail. Never claim work is done. Never offer Studio Crew as rentable. If asked about non-Crewtopia topics, answer briefly and steer back.`;

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_teams',
      description: 'List rentable AI teams: names, rates, roles, availability.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rent_quote',
      description: 'Create a rental quote. minutes MUST be user-confirmed time.',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string', description: 'Team id from list_teams.' },
          minutes: { type: 'number', description: 'User-confirmed rental minutes.' },
          brief: { type: 'string', description: 'Optional short note on what to build.' },
          budgetU: { type: 'string', description: 'Optional max spend in U.' },
        },
        required: ['teamId', 'minutes'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'message_member',
      description: 'Ask one crew member in a live funded rental. Omit taskId for the latest live crew.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Rental task id (optional).' },
          role: { type: 'string', description: 'pm, ux, frontend, or backend.' },
          message: { type: 'string', description: 'What to ask the member.' },
        },
        required: ['role', 'message'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_preview',
      description: 'Mint a fresh 15-min preview link for a live rental. Only call when the user asks to see the work.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Rental task id (optional).' },
        },
        additionalProperties: false,
      },
    },
  },
];

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const baseURL = process.env.PROVIDER_BASE_URL ?? '';
    const apiKey = process.env.PROVIDER_API_KEY ?? '';
    const model = process.env.PROVIDER_MODEL ?? '';
    if (!baseURL || !apiKey || !model) {
      throw new Error('Server misconfigured: provider env missing');
    }
    client = new OpenAI({ baseURL, apiKey });
  }
  return client;
}

export function providerModel(): string {
  return process.env.PROVIDER_MODEL ?? '';
}

type AccumulatedCall = { id: string; name: string; args: string };

async function executeTool(name: string, rawArgs: string, owner: string): Promise<string> {
  let args: any = {};
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch {
    return JSON.stringify({ error: 'arguments must be JSON' });
  }
  try {
    if (name === 'list_teams') return JSON.stringify({ teams: listTeams() });
    if (name === 'rent_quote') return JSON.stringify(await rentQuote(args, owner));
    if (name === 'get_preview') {
      let taskId = String(args.taskId ?? '');
      if (!taskId) {
        const live = await findWorkingByBuyer(owner);
        if (!live) return JSON.stringify({ error: 'no live crew — the user must fund a rental first' });
        taskId = live.taskId;
      }
      const r: any = await handlePreviewLink(1, { task_id: taskId });
      if (r?.body) {
        const body = JSON.parse(r.body);
        if (body?.error) return JSON.stringify({ error: body.error.message ?? body.error });
        const text = body?.result?.status?.message?.parts?.[0]?.text ?? '';
        return JSON.stringify({ reply: text });
      }
      return JSON.stringify({ error: 'preview failed' });
    }
    if (name === 'message_member') {
      let taskId = String(args.taskId ?? '');
      if (!taskId) {
        const live = await findWorkingByBuyer(owner);
        if (!live) return JSON.stringify({ error: 'no live crew — the user must fund a rental first' });
        taskId = live.taskId;
      }
      const r = await relayToMember({
        taskId,
        role: String(args.role ?? ''),
        text: String(args.message ?? ''),
        owner,
        requireBuyer: true,
        budgetMs: 100_000,
      });
      return JSON.stringify({ reply: r.reply || r.note, runId: r.runId, done: r.done });
    }
    return JSON.stringify({ error: `unknown tool: ${name}` });
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Stream the assistant reply token-by-token, running tools mid-stream.
 * Text deltas yield live (including any pre-tool preamble); onStatus fires
 * before each tool executes so the client can show progress. Max 3 rounds.
 * Yields text deltas.
 */
export async function* streamReply(
  history: ChatMessage[],
  userText: string,
  onStatus?: (text: string) => Promise<void>,
  owner?: string,
): AsyncGenerator<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-20).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.text,
    })),
    { role: 'user', content: userText },
  ];

  for (let round = 0; round < 3; round++) {
    const stream = await getClient().chat.completions.create({
      model: providerModel(),
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      stream: true,
    });
    const calls = new Map<number, AccumulatedCall>();
    let textYielded = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta as any;
      const text: string = delta?.content ?? '';
      if (text) {
        textYielded += text;
        yield text;
      }
      for (const tc of delta?.tool_calls ?? []) {
        const i = tc.index ?? 0;
        const cur = calls.get(i) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(i, cur);
      }
    }
    if (calls.size === 0) return;
    const toolCalls = [...calls.values()].filter((c) => c.name);
    messages.push({
      role: 'assistant',
      content: textYielded || null,
      tool_calls: toolCalls.map((c) => ({
        id: c.id || `call_${round}_${c.name}`,
        type: 'function' as const,
        function: { name: c.name, arguments: c.args || '{}' },
      })),
    } as any);
    for (const c of toolCalls) {
      const label =
        c.name === 'list_teams'
          ? 'Checking available teams…'
          : c.name === 'message_member'
            ? 'Asking the team…'
            : c.name === 'get_preview'
              ? 'Grabbing the preview…'
              : 'Pricing your rental…';
      await onStatus?.(label);
      const result = await executeTool(c.name, c.args, owner ?? '');
      messages.push({
        role: 'tool',
        tool_call_id: c.id || `call_${round}_${c.name}`,
        content: result,
      } as any);
    }
  }
}
