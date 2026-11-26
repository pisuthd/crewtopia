/** One-off: server funds the third-party buyer wallet with U for the e2e. */
import { createWalletClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import { loadEnv } from '@bnbagent/sdk';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

loadEnv(join(dirname(fileURLToPath(import.meta.url)), '..'));
const U = '0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565' as const;
const server = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const cli = createWalletClient({ account: server, chain: bscTestnet, transport: http() });
const buyer = '0xF1B2e5a604F933bc4Fca146416dF8cd4ba4aE92c' as const;
const hash = await cli.writeContract({
  address: U,
  abi: [{ name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const,
  functionName: 'transfer', args: [buyer, parseUnits('0.006', 18)], chain: bscTestnet, account: server,
});
console.log('transfer:', hash);
