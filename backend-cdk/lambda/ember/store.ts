import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE ?? '';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE ?? '';
const PROFILES_TABLE = process.env.PROFILES_TABLE ?? '';

export type ChatMessage = { role: 'user' | 'assistant'; text: string; at: string };
export type Conversation = {
  conversationId: string;
  ownerAddress: string;
  assistantId: string;
  messages: ChatMessage[];
  updatedAt: string;
};

const MAX_MESSAGES = 50;

export function conversationIdFor(ownerAddress: string, assistantId: string): string {
  return `${ownerAddress.toLowerCase()}#${assistantId}`;
}

export async function getConversation(ownerAddress: string, assistantId: string): Promise<Conversation> {
  const conversationId = conversationIdFor(ownerAddress, assistantId);
  const out = await ddb.send(new GetCommand({ TableName: CONVERSATIONS_TABLE, Key: { conversationId } }));
  const existing = out.Item as Conversation | undefined;
  if (existing) return existing;
  return {
    conversationId,
    ownerAddress: ownerAddress.toLowerCase(),
    assistantId,
    messages: [],
    updatedAt: new Date().toISOString(),
  };
}

export async function appendMessages(
  ownerAddress: string,
  assistantId: string,
  extra: ChatMessage[],
): Promise<Conversation> {
  const convo = await getConversation(ownerAddress, assistantId);
  const messages = [...convo.messages, ...extra].slice(-MAX_MESSAGES);
  const updated: Conversation = { ...convo, messages, updatedAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: CONVERSATIONS_TABLE, Item: updated }));
  return updated;
}

export async function assignAssistant(ownerAddress: string, assistantId: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: PROFILES_TABLE,
      Key: { walletAddress: ownerAddress.toLowerCase() },
      UpdateExpression: 'SET assistantId = :a, assistantAssignedAt = :t, updatedAt = :t',
      ExpressionAttributeValues: { ':a': assistantId, ':t': new Date().toISOString() },
    }),
  );
}

export async function unassignAssistant(ownerAddress: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: PROFILES_TABLE,
      Key: { walletAddress: ownerAddress.toLowerCase() },
      UpdateExpression: 'REMOVE assistantId, assistantAssignedAt SET updatedAt = :t',
      ExpressionAttributeValues: { ':t': new Date().toISOString() },
    }),
  );
}

export async function deleteConversation(ownerAddress: string, assistantId: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { conversationId: conversationIdFor(ownerAddress, assistantId) },
    }),
  );
}

// ---- Member threads (per task + role, same table) ----

export function memberConversationId(ownerAddress: string, taskId: string, role: string): string {
  return `${ownerAddress.toLowerCase()}#${taskId}#${role}`;
}

async function getConversationById(conversationId: string, ownerAddress: string): Promise<Conversation> {
  const out = await ddb.send(new GetCommand({ TableName: CONVERSATIONS_TABLE, Key: { conversationId } }));
  const existing = out.Item as Conversation | undefined;
  if (existing) return existing;
  return {
    conversationId,
    ownerAddress: ownerAddress.toLowerCase(),
    assistantId: conversationId,
    messages: [],
    updatedAt: new Date().toISOString(),
  };
}

export async function getMemberConversation(ownerAddress: string, taskId: string, role: string): Promise<Conversation> {
  return getConversationById(memberConversationId(ownerAddress, taskId, role), ownerAddress);
}

export async function appendMemberMessages(
  ownerAddress: string,
  taskId: string,
  role: string,
  extra: ChatMessage[],
): Promise<Conversation> {
  const convo = await getMemberConversation(ownerAddress, taskId, role);
  const messages = [...convo.messages, ...extra].slice(-MAX_MESSAGES);
  const updated: Conversation = { ...convo, messages, updatedAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: CONVERSATIONS_TABLE, Item: updated }));
  return updated;
}

// ---- WebSocket connections ----

const CONNECTION_TTL_S = 2 * 3600;

export async function putConnection(connectionId: string, walletAddress: string): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: {
        connectionId,
        walletAddress: walletAddress.toLowerCase(),
        ttl: Math.floor(Date.now() / 1000) + CONNECTION_TTL_S,
      },
    }),
  );
}

export async function getConnection(connectionId: string): Promise<string | null> {
  const out = await ddb.send(
    new GetCommand({ TableName: CONNECTIONS_TABLE, Key: { connectionId } }),
  );
  const item = out.Item as { walletAddress?: string } | undefined;
  return item?.walletAddress ?? null;
}

export async function deleteConnection(connectionId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: CONNECTIONS_TABLE, Key: { connectionId } }));
}
