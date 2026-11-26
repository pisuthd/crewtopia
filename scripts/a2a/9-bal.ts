/** Read-only balances for a wallet: tBNB + U. Usage: npx tsx a2a/9-bal.ts [addr] */
import { createPublicClient, formatUnits, http } from 'viem';
import { bscTestnet } from 'viem/chains';

const U = '0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565' as const;
const addr = (process.argv[2] ?? '0xF1B2e5a604F933bc4Fca146416dF8cd4ba4aE92c') as `0x${string}`;
const pub = createPublicClient({ chain: bscTestnet, transport: http('https://data-seed-prebsc-1-s1.binance.org:8545') });
const [gas, u] = await Promise.all([
  pub.getBalance({ address: addr }),
  pub.readContract({ address: U, abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const, functionName: 'balanceOf', args: [addr] }) as Promise<bigint>,
]);
console.log(addr, 'tBNB:', formatUnits(gas, 18), '| U:', formatUnits(u, 18));
