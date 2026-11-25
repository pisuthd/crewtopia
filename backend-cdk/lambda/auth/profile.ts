import { requireAuth } from './tokens';
import { getOrCreateProfile, renameProfile } from './store';

const NAME_MAX = 40;

export async function handleGetProfile(headers: Record<string, string | undefined>) {
  let address: string;
  try {
    address = await requireAuth(headers);
  } catch {
    return { statusCode: 401, body: { error: 'missing or invalid session token' } };
  }
  const profile = await getOrCreateProfile(address);
  return { statusCode: 200, body: { profile } };
}

export async function handleRenameProfile(headers: Record<string, string | undefined>, body: any) {
  let address: string;
  try {
    address = await requireAuth(headers);
  } catch {
    return { statusCode: 401, body: { error: 'missing or invalid session token' } };
  }
  const displayName = String(body?.displayName ?? '').trim();
  if (!displayName || displayName.length > NAME_MAX) {
    return { statusCode: 400, body: { error: `displayName must be 1–${NAME_MAX} chars` } };
  }
  const profile = await renameProfile(address, displayName);
  return { statusCode: 200, body: { profile } };
}
