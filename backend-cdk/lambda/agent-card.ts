import type { APIGatewayProxyHandler } from 'aws-lambda';
import { TEAM_REGISTRY, type TeamDef } from './pricelist';

// AgentCards for Crewtopia teams (A2A discovery documents) — option B:
// one on-chain agent + one card per team.
//
// Served at:
//   /.well-known/agent-card.json                → primary team (dev-crew, back-compat)
//   /.well-known/teams/{teamId}/agent-card.json → per-team card (+ agent.json alias)
//
// Convention (unchanged): card skills are the WIRE PROTOCOL (what JSON
// data-part to send), not team roles. Skill ids keep the `web3-` prefix for
// wire stability. Teams not yet rentable (studio) get a discovery-only card
// — no hire skills until registration day.
const BASE = 'https://h9907ecjy9.execute-api.ap-southeast-1.amazonaws.com/prod';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function negotiateSkill(team: TeamDef) {
  return {
    id: 'negotiate-web3-task',
    name: `Rent the ${team.display}`,
    description:
      `Send a data part {"skill": "negotiate-web3-task", "teamId": "${team.id}", "brief": "<what to build + ~minutes>", "budgetU": "<optional max in U>"} and receive a rental quote envelope (rate ${team.rateUPerHour} U/hr, 6-min chunks, funded minutes, escrow terms, negotiation_hash, provider_sig). Anchor the returned envelope on-chain via createJob, then fund it. teamId defaults to ${team.id} on this card; same contextId renews the session.`,
    tags: ['web3', 'negotiation', 'erc8183', 'bnb-chain'],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
  };
}

function acceptSkill() {
  return {
    id: 'accept-web3-quote',
    name: 'Accept a rental quote',
    description:
      'Send {"skill": "accept-web3-quote", "task_id": "<uuid>", "buyerAddress": "<your wallet>", "nonce": "<unique>", "buyerSig": "<EIP-191 sig>"} to accept the quoted rental total. The team creates the ERC-8183 escrow job (provider = team wallet) and returns { jobId, priceWei, token } — fund it on-chain, then track with web3-task-status until WORKING.',
    tags: ['web3', 'escrow', 'erc8183', 'bnb-chain'],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
  };
}

function statusSkill() {
  return {
    id: 'web3-task-status',
    name: 'Rental task status',
    description:
      'Send {"skill": "web3-task-status", "task_id": "<uuid>"} for a read-only task lookup (status, quote, jobId, receipts, plus a rental-clock artifact: funded/elapsed/seconds-left so you know how much rented time remains). Poll it to watch the clock; extend with crew-extend before it hits zero to continue.',
    tags: ['web3', 'status', 'erc8183'],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
  };
}

function extendSkill() {
  return {
    id: 'crew-extend',
    name: 'Top up a live rental',
    description:
      'Send {"skill": "crew-extend", "task_id": "<uuid>", "minutes": <number>, "buyerAddress": "<your wallet>", "nonce": "<unique>", "buyerSig": "<EIP-191 sig>"} to top up a WORKING rental. Returns a renewal quote — then call accept-web3-quote with the same task_id (+ same buyer triple) to mint the renewal escrow job, fund it on-chain, and the clock extends once FUNDED is observed.',
    tags: ['web3', 'escrow', 'erc8183', 'renewal'],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
  };
}

function endSkill() {
  return {
    id: 'crew-end',
    name: 'End a rental early',
    description:
      'Send {"skill": "crew-end", "task_id": "<uuid>", "buyerAddress": "<your wallet>", "nonce": "<unique>", "buyerSig": "<EIP-191 sig>"} to end a rental. The clock stops, crew chat hard-stops, the one-team slot frees. Escrow stays locked per job — settle delivered work with web3-deliver, or claimRefund on-chain after expiry.',
    tags: ['web3', 'escrow', 'erc8183'],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
  };
}

function threadSkill() {
  return {
    id: 'crew-thread',
    name: 'Chat with the hired crew',
    description:
      'Send {"skill": "crew-thread", "task_id": "<uuid>", "to": "lead|<role>|@Name", "text": "<message>", "buyerAddress": "<your wallet>", "nonce": "<unique>", "buyerSig": "<EIP-191 sig>"} to talk to the crew like the app buyer does — one thread, addressed at the lead by default, @mention a member to reach them directly. Returns this turn only {runId, replies: [{role, name, text}], cursor, done, needs_input} — deltas, never the transcript; keep your own context. Turns burn rented minutes, so one call per conversational turn and never poll-spin: if done:false, re-call with runId + cursor to continue. Watch the clock with web3-task-status.',
    tags: ['web3', 'chat', 'crew', 'erc8183'],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
  };
}

function buildCard(team: TeamDef) {
  const hireable = team.status === 'available';
  return {
    protocolVersion: '0.3.0',
    name: team.agentName,
    description:
      team.description +
      (hireable
        ? ` Flat ${team.rateUPerHour} U/hour, billed in 6-min chunks. Send negotiate-web3-task with a brief (+ optional minutes, budgetU cap) to receive a rental quote in U; fund the ERC-8183 escrow job and the team builds it. Top up live rentals with crew-extend, end early with crew-end. Track with web3-task-status. Disputes go directly on-chain against the escrow job within the dispute window — no skill needed.`
        : ' Coming soon — not rentable yet.'),
    url: `${BASE}/a2a`,
    preferredTransport: 'JSONRPC',
    version: '0.1.0',
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    // Namespaced platform extension (unknown fields are ignored by SDK
    // buyers): which team this card is for and whether it can be hired.
    'x-crewtopia-team': {
      teamId: team.id,
      display: team.display,
      status: team.status,
      roles: team.roles,
      members: team.members,
      rateUPerHour: team.rateUPerHour,
    },
    skills: hireable
      ? [negotiateSkill(team), acceptSkill(), statusSkill(), threadSkill(), extendSkill(), endSkill()]
      : [],
  };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const params = (event.pathParameters ?? {}) as Record<string, string | undefined>;
  const m = /\/teams\/([^/]+)/.exec(event.path ?? '');
  const teamId = params.teamId ?? m?.[1] ?? 'dev-crew';
  const team = TEAM_REGISTRY[teamId];
  if (!team) {
    return {
      statusCode: 404,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: `unknown team '${teamId}'. Known: ${Object.keys(TEAM_REGISTRY).join(', ')}` }),
    };
  }
  return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(buildCard(team)) };
};
