/**
 * Third-party A2A hire: a NON-operator buyer wallet over the real wire —
 * negotiate → accept(params) → buyer anchors → fund → report → working → end.
 * Proves the escrow fix for wallets that never held the server key.
 * Spends ~0.002 U (12 min). Run: npx tsx a2a/9-buyer-hire.ts
 * Needs: FEEDBACK_KEY (buyer with U + tBNB), API_BASE_URL.
 */
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import { EVMWalletProvider, ERC8183Client, loadEnv } from '@bnbagent/sdk';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorAndFund } from './anchor.js';

loadEnv(join(dirname(fileURLToPath(import.meta.url)), '..'));
const BASE = (process.env.API_BASE_URL ?? '').replace(/\/+$/, '');
if (!BASE) throw new Error('need API_BASE_URL');
const rawKey = process.env.FEEDBACK_KEY;
if (!rawKey) throw new Error('FEEDBACK_KEY required (third-party buyer)');
const account = privateKeyToAccount(rawKey as `0x${string}`);
const signer = createWalletClient({ account, chain: bscTestnet, transport: http() });

async function send(data: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE}/a2a/message/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'message/send', params: { message: { messageId: crypto.randomUUID(), role: 'user', parts: [{ kind: 'data', data }] } } }),
  });
  return res.json();
}
const text = (r: any): string => r?.result?.status?.message?.parts?.[0]?.text ?? JSON.stringify(r?.result ?? r?.error ?? r).slice(0, 200);
const check = (n: string, c: unknown, x = '') => console.log(`${c ? '  ok' : '  FAIL'} — ${n}${x ? ` (${x})` : ''}`);

async function main(): Promise<void> {
  console.log('buyer =', account.address);
  const bind = async (t: string) => {
    const nonce = `${t}-${Date.now()}`;
    return { nonce, sig: await signer.signMessage({ message: `Crewtopia hire binding v1\nbuyer: ${account.address}\nnonce: ${nonce}` }) };
  };
  const b0 = await bind('tp-neg');
  const r1 = await send({ skill: 'negotiate-web3-task', teamId: 'dev-crew', brief: 'Third-party probe: static hello page.', minutes: 12, buyerAddress: account.address, nonce: b0.nonce, buyerSig: b0.sig });
  const taskId = /task_id ([0-9a-f-]{36})/.exec(text(r1))?.[1] ?? '';
  check('negotiate returns task_id', !!taskId, taskId);
  if (!taskId) throw new Error('no task: ' + text(r1).slice(0, 200));
  const buyerClient = await ERC8183Client.create({ walletProvider: new EVMWalletProvider({ password: process.env.WALLET_PASSWORD!, privateKey: rawKey }), network: 'bsc-testnet' });
  const { jobId } = await anchorAndFund({ send, bind, buyerClient, buyerAddress: account.address, taskId, tag: 'tp-acc' });
  check('buyer anchored + funded', !!jobId, `job ${jobId}`);
  let working = '';
  for (let i = 0; i < 20; i++) {
    const r3 = await send({ skill: 'web3-task-status', task_id: taskId });
    if (/status=working/.test(text(r3))) { working = text(r3).slice(0, 120); break; }
    await new Promise((r) => setTimeout(r, 30000));
  }
  check('flips to WORKING', !!working, working);
  const b5 = await bind('tp-end');
  const r7 = await send({ skill: 'crew-end', task_id: taskId, buyerAddress: account.address, nonce: b5.nonce, buyerSig: b5.sig });
  check('crew-end ends rental', (r7?.result as any)?.state === 'ended', JSON.stringify(r7?.result ?? r7?.error).slice(0, 120));
  console.log('third-party hire GREEN');
}
void main();
