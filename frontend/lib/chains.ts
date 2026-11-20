'use client';

import { bscTestnet } from 'viem/chains';

// Crewtopia is BNB Testnet-only. Single chain — never mainnet from this app.
export const BNB_TESTNET_ID = bscTestnet.id; // 97

export function getAddChainParams() {
  return {
    chainId: `0x${BNB_TESTNET_ID.toString(16)}`,
    chainName: bscTestnet.name,
    rpcUrls: bscTestnet.rpcUrls.default.http,
    blockExplorerUrls: [bscTestnet.blockExplorers.default.url],
    nativeCurrency: bscTestnet.nativeCurrency,
  };
}

export function getExplorerAddressUrl(address: string): string {
  return `${bscTestnet.blockExplorers.default.url}/address/${address}`;
}
