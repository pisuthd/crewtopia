import { isAddress, recoverMessageAddress } from 'viem';
import { signInMessage } from './messages';
import { mintSession } from './tokens';
import { getOrCreateProfile, takeNonce } from './store';

export async function handleVerify(body: any) {
  const address = String(body?.address ?? '');
  const signature = body?.signature as `0x${string}` | undefined;
  if (!isAddress(address) || !signature) {
    return { statusCode: 400, body: { error: 'verify needs { address, signature }' } };
  }
  // Single-use + expiry enforced server-side; the client never supplies time.
  const issued = await takeNonce(address);
  if (!issued) {
    return { statusCode: 401, body: { error: 'no sign-in started — request a nonce first' } };
  }
  if (issued.expiresAt * 1000 < Date.now()) {
    return { statusCode: 401, body: { error: 'nonce expired — request a fresh one' } };
  }
  // Exact-byte recovery: the client must have signed the nonce message
  // verbatim (address + our nonce + our issuedAt). Any drift fails closed.
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: signInMessage(address, issued.nonce, issued.issuedAt),
      signature,
    });
  } catch {
    return { statusCode: 401, body: { error: 'signature is not a valid EIP-191 signature' } };
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return { statusCode: 401, body: { error: 'signature does not match address' } };
  }
  const profile = await getOrCreateProfile(address);
  const token = await mintSession(address);
  return { statusCode: 200, body: { token, profile } };
}
