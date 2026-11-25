import { randomBytes } from 'node:crypto';
import { isAddress } from 'viem';
import { signInMessage } from './messages';
import { putNonce } from './store';

const NONCE_TTL_S = 600; // 10 minutes to sign

export async function handleNonce(body: any) {
  const address = String(body?.address ?? '');
  if (!isAddress(address)) {
    return { statusCode: 400, body: { error: 'nonce needs a valid address' } };
  }
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + NONCE_TTL_S;
  await putNonce(address, nonce, issuedAt, expiresAt);
  return {
    statusCode: 200,
    body: { address: address.toLowerCase(), nonce, message: signInMessage(address, nonce, issuedAt), issuedAt, expiresAt },
  };
}
