'use client';

const LS_KEY = 'crewtopia:session';
const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') ?? '';

export interface Profile {
  walletAddress: string;
  displayName: string | null;
  assistantId: string | null;
  assistantAssignedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function loadToken(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(LS_KEY, token);
    else localStorage.removeItem(LS_KEY);
  } catch {}
}

/** Read the JWT sub (wallet address) without verifying — server verifies. */
export function tokenSubject(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.sub === 'string' ? payload.sub.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function api(path: string, init?: RequestInit, token?: string | null) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
  return body as Record<string, unknown>;
}

export async function requestNonce(address: string): Promise<{ message: string; nonce: string }> {
  const body = await api('/auth/nonce', {
    method: 'POST',
    body: JSON.stringify({ address }),
  });
  return { message: body.message as string, nonce: body.nonce as string };
}

export async function verifySignature(address: string, signature: string): Promise<{ token: string; profile: Profile }> {
  const body = await api('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ address, signature }),
  });
  return { token: body.token as string, profile: body.profile as Profile };
}

export async function fetchProfile(token: string): Promise<Profile> {
  const body = await api('/profile', undefined, token);
  return body.profile as Profile;
}

export async function renameProfile(token: string, displayName: string): Promise<Profile> {
  const body = await api(
    '/profile',
    { method: 'PUT', body: JSON.stringify({ displayName }) },
    token,
  );
  return body.profile as Profile;
}
