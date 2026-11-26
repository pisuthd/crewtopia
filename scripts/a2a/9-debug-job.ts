/** Read-only: show job client/provider/status/budget for a job id. */
import { ERC8183Client, EVMWalletProvider, loadEnv } from '@bnbagent/sdk';

const jobId = BigInt(process.argv[2] ?? '1882');
loadEnv();
const buyer = new EVMWalletProvider({ password: process.env.WALLET_PASSWORD!, privateKey: process.env.PRIVATE_KEY! });
const escrow = await ERC8183Client.create({ walletProvider: buyer, network: 'bsc-testnet' });
const job: any = await escrow.getJob(jobId);
console.log(JSON.stringify({ client: job.client ?? job[1], provider: job.provider ?? job[2], status: String(job.status ?? job[0]), budget: String(job.budget ?? job[3] ?? job.budgetWei ?? '') }, null, 2));
