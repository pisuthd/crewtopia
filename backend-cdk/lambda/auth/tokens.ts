import * as jose from 'jose';

const SESSION_TTL = '7d';

function signingKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET ?? '';
  if (!secret) throw new Error('Server misconfigured: SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

/** Mint a session JWT, sub = lowercase wallet address. */
export async function mintSession(address: string): Promise<string> {
  return new jose.SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(address.toLowerCase())
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(signingKey());
}

/** Verify a session JWT; returns the bound address or throws. */
export async function verifySession(token: string): Promise<string> {
  const { payload } = await jose.jwtVerify(token, signingKey());
  if (!payload.sub) throw new Error('session has no subject');
  return payload.sub;
}

/** Extract + verify the Bearer session; returns the wallet address. */
export async function requireAuth(headers: Record<string, string | undefined>): Promise<string> {
  const raw = headers.authorization ?? headers.Authorization ?? '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  if (!token) throw new Error('missing session token');
  return verifySession(token);
}
