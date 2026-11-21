'use client';

import { createPublicClient, formatUnits, getAddress, http, type WalletClient } from 'viem';
import { bscTestnet } from 'viem/chains';

/** U (United Stables) faucet on BNB Testnet — same contract as scripts/probes/0-faucet-claim.ts. */
export const FAUCET_ADDRESS = getAddress('0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3');

const FAUCET_ABI = [
  { type: 'function', name: 'tokenInstance', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokenAmount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'requestTokens', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const;

const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export interface FaucetState {
  token: `0x${string}`;
  drip: string;
  balance: string;
  funded: boolean;
}

const publicClient = () => createPublicClient({ chain: bscTestnet, transport: http() });

export async function getFaucetState(address: `0x${string}`): Promise<FaucetState> {
  const pc = publicClient();
  const [token, drip] = await Promise.all([
    pc.readContract({ address: FAUCET_ADDRESS, abi: FAUCET_ABI, functionName: 'tokenInstance' }),
    pc.readContract({ address: FAUCET_ADDRESS, abi: FAUCET_ABI, functionName: 'tokenAmount' }),
  ]);
  const tokenAddr = getAddress(token);
  const bal = (await pc.readContract({
    address: tokenAddr,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  })) as bigint;
  return {
    token: tokenAddr,
    drip: formatUnits(drip, 18),
    balance: formatUnits(bal, 18),
    funded: bal > BigInt(0),
  };
}

export async function requestTestTokens(client: WalletClient, account: `0x${string}`): Promise<`0x${string}`> {
  // The wallet app can silently drift to another network after connect
  // (phantom hash, never broadcast). Refuse before signing.
  const chainId = await client.getChainId();
  if (chainId !== bscTestnet.id) {
    throw new Error(`wallet is on chain ${chainId} — switch to BNB Testnet in your wallet and retry`);
  }
  // Gas comes from our own node with a 20% buffer — the wallet's estimate
  // has produced underpriced txs the network never propagates.
  const price = await publicClient().getGasPrice();
  const hash = await client.writeContract({
    address: FAUCET_ADDRESS,
    abi: FAUCET_ABI,
    functionName: 'requestTokens',
    chain: bscTestnet,
    account,
    gasPrice: (price * BigInt(120)) / BigInt(100),
  });
  return hash;
}

/** True once a node actually sees the tx — guards phantom wallet hashes. */
export async function txSeen(hash: `0x${string}`): Promise<boolean> {
  try {
    return (await publicClient().getTransaction({ hash })) !== null;
  } catch {
    return false;
  }
}

export async function waitForClaim(hash: `0x${string}`): Promise<void> {
  const receipt = await publicClient().waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== 'success') throw new Error(`claim reverted: ${hash}`);
}

export const explorerTx = (hash: string): string => `https://testnet.bscscan.com/tx/${hash}`;
