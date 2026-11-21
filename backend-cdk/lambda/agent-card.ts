import type { APIGatewayProxyHandler } from 'aws-lambda';

// AgentCard for `wayfind-dev-team` (A2A discovery document).
// Served at /.well-known/agent-card.json.
//
// Convention follows the bnbagent-sdk A2A example: card skills are the WIRE
// PROTOCOL (what JSON data-part to send), not team roles. The Dev Team
// (PM · UX/UI · Frontend · Backend) is internal routing behind
// `negotiate-web3-task`. Skill ids keep the `web3-` prefix for wire
// stability; display copy uses the Dev Team rental model. `name` stays
// `wayfind-dev-team` — it is the registered on-chain agent identity.
const card = {
  protocolVersion: '0.3.0',
  name: 'wayfind-dev-team',
  description:
    'Crewtopia Dev Crew for rent: PM, UX/UI designer, frontend dapp developer, backend API developer. Flat 0.01 U/hour, billed in 6-min chunks. Send negotiate-web3-task with a brief (+ optional minutes, budgetU cap) to receive a rental quote in U; fund the ERC-8183 escrow job and the team builds it. Renew with the same contextId to continue. Track with web3-task-status.',
  url: 'https://8lgt6x9mn8.execute-api.ap-southeast-1.amazonaws.com/prod/a2a',
  preferredTransport: 'JSONRPC',
  version: '0.1.0-dryrun',
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['application/json'],
  skills: [
    {
      id: 'negotiate-web3-task',
      name: 'Rent the Dev Team',
      description:
        'Send a data part {"skill": "negotiate-web3-task", "brief": "<what to build + ~minutes>", "budgetU": "<optional max in U>"} and receive a rental quote envelope (rate 0.01 U/hr, 6-min chunks, funded minutes, escrow terms, negotiation_hash, provider_sig). Anchor the returned envelope on-chain via createJob, then fund it. Same contextId renews the session.',
      tags: ['web3', 'negotiation', 'erc8183', 'bnb-chain'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    },
    {
      id: 'accept-web3-quote',
      name: 'Accept a rental quote',
      description:
        'Send {"skill": "accept-web3-quote", "task_id": "<uuid>", "buyerAddress": "<your wallet>", "nonce": "<unique>", "buyerSig": "<EIP-191 sig>"} to accept the quoted rental total. The team creates the ERC-8183 escrow job (provider = team wallet) and returns { jobId, priceWei, token } — fund it on-chain, then track with web3-task-status until WORKING.',
      tags: ['web3', 'escrow', 'erc8183', 'bnb-chain'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    },
    {
      id: 'web3-deliver',
      name: 'Deliver / settle a rental (team operator only)',
      description:
        'Send {"skill": "web3-deliver", "task_id": "<uuid>", "action": "submit|settle", "providerAddress": "<team wallet>", "nonce": "<unique>", "providerSig": "<EIP-191 sig>"} signed over "Crewtopia deliver v1...". Submit pins the receipt URL on-chain; settle releases escrow once the dispute window closes (buyerSig over "Crewtopia approve v1..." pre-authorizes it).',
      tags: ['web3', 'delivery', 'escrow', 'erc8183'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    },
    {
      id: 'web3-task-status',
      name: 'Rental task status',
      description:
        'Send {"skill": "web3-task-status", "task_id": "<uuid>"} for a read-only task lookup (status, quote, jobId, receipts, preview URL).',
      tags: ['web3', 'status', 'erc8183'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    },
    {
      id: 'team-message',
      name: 'Message a crew member',
      description:
        'Send {"skill": "team-message", "task_id": "<uuid>", "role": "pm|ux|frontend|backend", "message": "<text>"} to talk to one named crew member inside a live (funded) rental. Replies with the member answer.',
      tags: ['web3', 'chat', 'team'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    },
    {
      id: 'preview-link',
      name: 'Preview link',
      description:
        'Send {"skill": "preview-link", "task_id": "<uuid>"} for a fresh 15-min browser URL of the live dev server. Repeatable — ask again when it expires. Fails gracefully if nothing is serving yet.',
      tags: ['web3', 'preview', 'share'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    },
  ],
};

export const handler: APIGatewayProxyHandler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(card),
});
