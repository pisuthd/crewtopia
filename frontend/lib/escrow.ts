'use client';

import { createPublicClient, formatUnits, getAddress, http, type WalletClient } from 'viem';
import { bscTestnet } from 'viem/chains';

/** ERC-8183 Commerce (escrow) + U token on BNB Testnet — mirrors @bnbagent/sdk config. */
export const COMMERCE_ADDRESS = getAddress('0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de');
export const U_TOKEN_ADDRESS = getAddress('0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565');

const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

const COMMERCE_ABI = [
  { type: 'function', name: 'fund', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }], outputs: [] },
] as const;

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') ?? '';

const publicClient = () => createPublicClient({ chain: bscTestnet, transport: http() });

async function gasPriceBuffered() {
  const price = await publicClient().getGasPrice();
  return (price * BigInt(120)) / BigInt(100);
}

/** Canonical buyer-binding message — must match backend lambda/a2a/messages.ts. */
export function bindMessage(buyerAddress: string, nonce: string): string {
  return `Crewtopia hire binding v1\nbuyer: ${buyerAddress}\nnonce: ${nonce}`;
}

export async function getUBalance(address: `0x${string}`): Promise<string> {
  const bal = (await publicClient().readContract({
    address: U_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  })) as bigint;
  return formatUnits(bal, 18);
}

export async function approveU(client: WalletClient, account: `0x${string}`, amountWei: bigint): Promise<`0x${string}`> {
  const chainId = await client.getChainId();
  if (chainId !== bscTestnet.id) throw new Error(`wallet is on chain ${chainId} — switch to BNB Testnet and retry`);
  return client.writeContract({
    address: U_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [COMMERCE_ADDRESS, amountWei],
    chain: bscTestnet,
    account,
    gasPrice: await gasPriceBuffered(),
  });
}

export async function fundJob(
  client: WalletClient,
  account: `0x${string}`,
  jobId: bigint,
  amountWei: bigint,
): Promise<`0x${string}`> {
  const chainId = await client.getChainId();
  if (chainId !== bscTestnet.id) throw new Error(`wallet is on chain ${chainId} — switch to BNB Testnet and retry`);
  return client.writeContract({
    address: COMMERCE_ADDRESS,
    abi: COMMERCE_ABI,
    functionName: 'fund',
    args: [jobId, amountWei, '0x'],
    chain: bscTestnet,
    account,
    gasPrice: await gasPriceBuffered(),
  });
}

/** Public A2A call (no session needed) — accept quote / poll status. */
export async function a2aSend(data: Record<string, unknown>): Promise<{ text: string; artifacts: any[] }> {
  let res: Response;
  try {
    res = await fetch(`${API}/a2a/message/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: { message: { messageId: crypto.randomUUID(), role: 'user', parts: [{ kind: 'data', data }] } },
      }),
    });
  } catch {
    throw new Error('Network unreachable — check your connection and retry. Nothing moved on-chain from this step alone.');
  }
  if (!res.ok) {
    if (res.status === 504 || res.status === 502 || res.status === 503) {
      throw new Error('Server timed out after 29s — on-chain work may still have completed. Retry: the card resumes from anything already created.');
    }
    throw new Error(`Server error ${res.status} — retry in a moment.`);
  }
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new Error('Unreadable server reply — retry. On-chain work may still have completed; the card resumes it.');
  }
  if (body?.error) throw new Error(body.error.message ?? 'A2A call failed');
  const msg = body?.result?.status?.message;
  const text: string = msg?.parts?.[0]?.text ?? '';
  const artifacts: any[] = body?.result?.artifacts ?? [];
  return { text, artifacts };
}

export function parseStatus(text: string): string | null {
  return /status=(\w+)/.exec(text)?.[1] ?? null;
}

export const explorerTx = (hash: string): string => `https://testnet.bscscan.com/tx/${hash}`;
