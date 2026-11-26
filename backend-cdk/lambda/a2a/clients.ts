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

/** Fire-and-forget internal sandbox action (Event invoke — no 29s clock). */
export async function invokeSandboxFn(action: string, payload: Record<string, unknown>): Promise<void> {
  const fn = process.env.SANDBOX_FN ?? '';
  if (!fn) throw new Error('server misconfigured: SANDBOX_FN is not set');
  await lambdaClient.send(
    new InvokeCommand({ FunctionName: fn, InvocationType: 'Event', Payload: JSON.stringify({ internal: true, action, ...payload }) }),
  );
}

/** Fire-and-forget crew boot: wallet sandbox + crew session start (async invokes). */
export async function bootCrewSandbox(wallet: string, taskId: string): Promise<string> {
  if (!SANDBOX_FN) return 'crew boot skipped (no SANDBOX_FN)';
  try {
    const payload = (action: string) => JSON.stringify({ internal: true, action, wallet, taskId });
    await lambdaClient.send(
      new InvokeCommand({ FunctionName: SANDBOX_FN, InvocationType: 'Event', Payload: payload('boot-sandbox') }),
    );
    await lambdaClient.send(
      new InvokeCommand({ FunctionName: SANDBOX_FN, InvocationType: 'Event', Payload: payload('start-crew') }),
    );
    return 'crew boot fired async (sandbox + crew session).';
  } catch (e) {
    return `crew boot failed (boot manually): ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Chain addresses the buyer needs to anchor the job themselves (buyer =
 * job client, so only the buyer wallet can create + fund). Read-only. */
export async function escrowAddrs(): Promise<{ commerce: string; router: string; policy: string; provider: string; token: string }> {
  const { client, provider } = await getEscrow();
  const anyClient = client as any;
  const commerce: string = anyClient.commerce?.address ?? anyClient.address ?? '';
  const router: string = anyClient.router?.address ?? '';
  const policy: string = anyClient.policy?.address ?? '';
  if (!commerce || !router || !policy) throw new Error('Server misconfigured: escrow addresses unresolved');
  const token: string = await client.paymentToken();
  return { commerce, router, policy, provider, token };
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
