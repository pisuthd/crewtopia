import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { LambdaMicrovmsClient } from '@aws-sdk/client-lambda-microvms';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { EVMWalletProvider, ERC8183Client } from '@bnbagent/sdk';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
export const TABLE = process.env.TASKS_TABLE ?? '';
const VM_REGION = process.env.AWS_REGION ?? 'ap-southeast-1';
export const vmClient = new LambdaMicrovmsClient({ region: VM_REGION });
const lambdaClient = new LambdaClient({ region: VM_REGION });
const SANDBOX_FN = process.env.SANDBOX_FN ?? '';

/** Fire-and-forget sandbox boot for a newly-WORKING task (async invoke). */
export async function autoBoot(taskId: string): Promise<string> {
  if (!SANDBOX_FN) return 'auto-boot skipped (no SANDBOX_FN)';
  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: SANDBOX_FN,
        InvocationType: 'Event',
        Payload: JSON.stringify({ task_id: taskId, internal: true }),
      }),
    );
    return 'sandbox boot fired async.';
  } catch (e) {
    return `auto-boot failed (boot manually): ${e instanceof Error ? e.message : String(e)}`;
  }
}

// Warm-start cache: chain + wallet clients survive across invocations.
let escrowClient: ERC8183Client | null = null;
let providerAddress = '';
export async function getEscrow(): Promise<{ client: ERC8183Client; provider: string }> {
  if (!escrowClient) {
    const privateKey = process.env.ESCROW_PRIVATE_KEY;
    const password = process.env.ESCROW_WALLET_PASSWORD;
    if (!privateKey || !password) throw new Error('Server misconfigured: escrow wallet env missing');
    // Stateless Lambda: in-memory-only wallet, no keystore disk writes.
    // (persist defaults to scrypt+write, which OOMs at 128MB.)
    const wallet = new EVMWalletProvider({ password, privateKey, persist: false });
    escrowClient = await ERC8183Client.create({ walletProvider: wallet, network: 'bsc-testnet' });
    providerAddress = wallet.address;
  }
  return { client: escrowClient, provider: providerAddress };
}
