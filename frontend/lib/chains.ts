'use client';

import { bscTestnet } from 'viem/chains';
import { createPublicClient, fallback, http } from 'viem';

// Crewtopia is BNB Testnet-only. Single chain — never mainnet from this app.
export const BNB_TESTNET_ID = bscTestnet.id; // 97

// Ordered fastest-first (probed 2026-11-22: publicnode ~0.3s, BNB seeds 1-2s).
// NEXT_PUBLIC_RPC_URLS (comma-separated) prepends env URLs so local/dev can
// pin a node. viem's fallback() tries in order, moving on on failure — one
// slow or blocked seed no longer takes the app down.
const ENV_URLS = (process.env.NEXT_PUBLIC_RPC_URLS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const RPC_URLS = [
  ...ENV_URLS,
  'https://bsc-testnet-rpc.publicnode.com',
  ...bscTestnet.rpcUrls.default.http,
  'https://data-seed-prebsc-2-s1.bnbchain.org:8545',
];

export function publicTransport() {
  return fallback(RPC_URLS.map((url) => http(url)));
}

export function getPublicClient() {
  return createPublicClient({ chain: bscTestnet, transport: publicTransport() });
}

export function getAddChainParams() {
  return {
    chainId: `0x${BNB_TESTNET_ID.toString(16)}`,
    chainName: bscTestnet.name,
    rpcUrls: RPC_URLS,
    blockExplorerUrls: [bscTestnet.blockExplorers.default.url],
    nativeCurrency: bscTestnet.nativeCurrency,
  };
}

export function getExplorerAddressUrl(address: string): string {
  return `${bscTestnet.blockExplorers.default.url}/address/${address}`;
}
