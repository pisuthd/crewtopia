/** Print ERC-8183 bsc-testnet addresses (commerce/router/policy/payment token). Read-only. */
import { ERC8183Client, EVMWalletProvider, loadEnv } from '@bnbagent/sdk';

loadEnv();
const wallet = new EVMWalletProvider({ password: process.env.WALLET_PASSWORD!, privateKey: process.env.PRIVATE_KEY! });
const escrow: any = await ERC8183Client.create({ walletProvider: wallet, network: 'bsc-testnet' });
console.log(JSON.stringify({
  commerce: escrow.commerce?.address ?? escrow.address,
  router: escrow.router?.address,
  policy: escrow.policy?.address,
  paymentToken: await escrow.paymentToken().catch((e: Error) => `ERR ${e.message.slice(0, 60)}`),
}, null, 2));
