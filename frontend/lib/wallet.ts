'use client';

import { createWalletClient, custom, formatEther, type WalletClient } from 'viem';
import { bscTestnet } from 'viem/chains';
import { BNB_TESTNET_ID, getAddChainParams, getPublicClient } from './chains';

export type EIP1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

export type WalletInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

export type Wallet = {
  info: WalletInfo;
  provider: EIP1193Provider;
};

type AnnounceDetail = {
  info: WalletInfo;
  provider: EIP1193Provider;
};

/**
 * Discover all EIP-6963 wallets.
 * Wallet-agnostic: treats every announcement identically, deduped by uuid.
 */
export function discoverWallets(timeoutMs = 400): Promise<Wallet[]> {
  if (typeof window === 'undefined') return Promise.resolve([]);
  return new Promise((resolve) => {
    const wallets = new Map<string, Wallet>();

    function handleProvider(event: Event) {
      const { info, provider } = (event as CustomEvent<AnnounceDetail>).detail;
      wallets.set(info.uuid, { info, provider });
    }

    window.addEventListener('eip6963:announceProvider', handleProvider as EventListener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', handleProvider as EventListener);
      resolve(Array.from(wallets.values()));
    }, timeoutMs);
  });
}

/** Switch (adding the chain first if the wallet doesn't know it, code 4902). */
export async function switchToBnbTestnet(provider: EIP1193Provider): Promise<void> {
  const hex = `0x${BNB_TESTNET_ID.toString(16)}`;
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hex }],
    });
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e?.code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [getAddChainParams()],
      });
    } else {
      throw err;
    }
  }
}

/**
 * Connect to the selected wallet and pin it to BNB Testnet.
 * Returns a viem WalletClient — same primitives the SDK/backend verify with.
 */
export async function connectWallet(wallet: Wallet): Promise<{
  wallet: Wallet;
  client: WalletClient;
  address: `0x${string}`;
  chainId: number;
}> {
  const client = createWalletClient({
    chain: bscTestnet,
    transport: custom(wallet.provider as unknown as Parameters<typeof custom>[0]),
  });
  await client.requestAddresses();
  const [address] = await client.getAddresses();
  if (!address) throw new Error('Wallet returned no accounts');
  let chainId = await client.getChainId();
  if (chainId !== BNB_TESTNET_ID) {
    await switchToBnbTestnet(wallet.provider);
    chainId = await client.getChainId();
  }
  return { wallet, client, address, chainId };
}

export function truncateAddress(addr: string): string {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const publicClient = getPublicClient();

/** Native tBNB balance, trimmed to 4 decimals for display. Null on failure. */
export async function fetchBnbBalance(address: `0x${string}`): Promise<string | null> {
  try {
    const wei = await publicClient.getBalance({ address });
    const full = formatEther(wei);
    const [whole, frac = ''] = full.split('.');
    return frac ? `${whole}.${frac.slice(0, 4).replace(/0+$/, '') || '0'}` : whole;
  } catch {
    return null;
  }
}
