import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const NONCES_TABLE = process.env.NONCES_TABLE ?? '';
const PROFILES_TABLE = process.env.PROFILES_TABLE ?? '';

export type Profile = {
  walletAddress: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NonceRecord = { nonce: string; issuedAt: string; expiresAt: number };

/** Store a fresh nonce (10-min life, Dynamo TTL cleans up). */
export async function putNonce(address: string, nonce: string, issuedAt: string, expiresAt: number): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: NONCES_TABLE,
      Item: { address: address.toLowerCase(), nonce, issuedAt, expiresAt },
    }),
  );
}

export async function takeNonce(address: string): Promise<NonceRecord | null> {
  const out = await ddb.send(
    new GetCommand({ TableName: NONCES_TABLE, Key: { address: address.toLowerCase() } }),
  );
  const item = out.Item as NonceRecord | undefined;
  if (!item) return null;
  // Single-use: consume on read. Expired nonces are dead either way.
  await ddb.send(new DeleteCommand({ TableName: NONCES_TABLE, Key: { address: address.toLowerCase() } }));
  return item;
}

export async function getProfile(address: string): Promise<Profile | null> {
  const out = await ddb.send(
    new GetCommand({ TableName: PROFILES_TABLE, Key: { walletAddress: address.toLowerCase() } }),
  );
  return (out.Item as Profile | undefined) ?? null;
}

/** Get-or-create: first sign-in mints a nameless profile keyed by wallet. */
export async function getOrCreateProfile(address: string): Promise<Profile> {
  const existing = await getProfile(address);
  if (existing) return existing;
  const now = new Date().toISOString();
  const profile: Profile = {
    walletAddress: address.toLowerCase(),
    displayName: null,
    createdAt: now,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: PROFILES_TABLE, Item: profile }));
  return profile;
}

export async function renameProfile(address: string, displayName: string): Promise<Profile> {
  const now = new Date().toISOString();
  const out = await ddb.send(
    new UpdateCommand({
      TableName: PROFILES_TABLE,
      Key: { walletAddress: address.toLowerCase() },
      UpdateExpression: 'SET displayName = :n, updatedAt = :u',
      ExpressionAttributeValues: { ':n': displayName, ':u': now },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return out.Attributes as Profile;
}
