/** Probe buyer-side job creation with RAW viem (exactly what the frontend will do).
 * createJob -> registerJob -> setBudget -> verify -> cancelOpen. No funds move. */
import { createPublicClient, createWalletClient, http, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadEnv } from '@bnbagent/sdk';

loadEnv();
import { bscTestnet } from 'viem/chains';

const COMMERCE = '0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE' as const;
const ROUTER = '0xD7d36D66d2F1B608A0F943f722D27e3744f66F25' as const;
const POLICY = '0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA' as const;

const ABI = [
  { type: 'function', name: 'createJob', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'string' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'registerJob', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [] },
  { type: 'function', name: 'setBudget', inputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'cancelOpen', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'jobs', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint8' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'string' }], stateMutability: 'view' },
  { type: 'event', name: 'JobCreated', inputs: [{ type: 'uint256', indexed: true, name: 'jobId' }, { type: 'address', indexed: true, name: 'client' }, { type: 'address', indexed: true, name: 'provider' }, { type: 'address', indexed: false, name: 'evaluator' }, { type: 'uint256', indexed: false, name: 'expiredAt' }, { type: 'address', indexed: false, name: 'hook' }] },
] as const;

const pk = (process.env.PROBE_KEY ?? process.env.PRIVATE_KEY ?? '') as `0x${string}`;
if (!pk) throw new Error('need PROBE_KEY or PRIVATE_KEY');
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const rpc = process.env.RPC_URL ?? 'https://data-seed-prebsc-1-s1.binance.org:8545';
const pub = createPublicClient({ chain: bscTestnet, transport: http(rpc) });
const cli = createWalletClient({ account, chain: bscTestnet, transport: http(rpc) });
console.log('caller =', account.address);

const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 7200);
const desc = JSON.stringify({ probe: 'buyer-create', taskId: 'probe-' + Date.now() });
const h1 = await cli.writeContract({ address: COMMERCE, abi: ABI, functionName: 'createJob', args: [account.address, ROUTER, expiredAt, desc, ROUTER], account } as any);
console.log('createJob tx:', h1);
const r1: any = await pub.waitForTransactionReceipt({ hash: h1 });
console.log('logs:', r1.logs.length, 'status:', r1.status);
for (const l of r1.logs) console.log(' -', l.address, l.topics[0]?.slice(0, 18), 'topics:', l.topics.length);
const logs = parseEventLogs({ abi: ABI, logs: r1.logs as any, eventName: 'JobCreated' }) as any[];
const jobId = logs[0]?.args?.jobId as bigint;
console.log('jobId =', String(jobId));

const h2 = await cli.writeContract({ address: ROUTER, abi: ABI, functionName: 'registerJob', args: [jobId, POLICY], account } as any);
await pub.waitForTransactionReceipt({ hash: h2 });
console.log('registerJob ok:', h2);

const h3 = await cli.writeContract({ address: COMMERCE, abi: ABI, functionName: 'setBudget', args: [jobId, 1000000000000000n, '0x'], account } as any);
await pub.waitForTransactionReceipt({ hash: h3 });
console.log('setBudget ok:', h3);

import { ERC8183Client, EVMWalletProvider, loadEnv } from '@bnbagent/sdk';

// read back via SDK (proves client == caller)
const sdk = await ERC8183Client.create({ walletProvider: new EVMWalletProvider({ password: process.env.WALLET_PASSWORD!, privateKey: (process.env.PRIVATE_KEY!.startsWith('0x') ? process.env.PRIVATE_KEY! : `0x${process.env.PRIVATE_KEY!}`) as `0x${string}` }), network: 'bsc-testnet' });
const job: any = await sdk.getJob(jobId);
console.log('job client =', job.client ?? job[1], '| provider =', job.provider ?? job[2], '| status =', String(job.status ?? job[0]));

const h4 = await cli.writeContract({ address: COMMERCE, abi: ABI, functionName: 'cancelOpen', args: [jobId], account } as any);
await pub.waitForTransactionReceipt({ hash: h4 });
console.log('cancelOpen ok (cleaned up):', h4);
console.log('PROBE GREEN');
