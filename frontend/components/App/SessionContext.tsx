'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchProfile,
  loadToken,
  renameProfile,
  requestNonce,
  saveToken,
  tokenSubject,
  verifySignature,
  type Profile,
} from '@/lib/session';
import { useWallet } from './WalletContext';

type SessionState = {
  token: string | null;
  profile: Profile | null;
  signingIn: boolean;
  error: string | null;
  /** True once the restore attempt settled (or there was nothing to restore). */
  ready: boolean;
};

type SessionContextValue = SessionState & {
  signedIn: boolean;
  signIn: () => Promise<{ token: string; profile: Profile }>;
  signOut: () => void;
  rename: (displayName: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { address, client } = useWallet();
  const [state, setState] = useState<SessionState>({
    token: null,
    profile: null,
    signingIn: false,
    error: null,
    ready: false,
  });
  // Auto sign-in attempts, one per address per mount. A rejection stops
  // retrying (no nag loop); switching wallets re-arms for the new address.
  const autoTried = useRef<Set<string>>(new Set());
  const signedOut = useRef(false);

  // Restore persisted session — but only for the currently connected wallet.
  // ready means "settled for THIS address": it resets on every address
  // change so auto sign-in can never fire mid-restore.
  useEffect(() => {
    if (!address) {
      setState((s) => (s.ready ? s : { ...s, ready: true }));
      return;
    }
    setState((s) => ({ ...s, ready: false }));
    const stored = loadToken();
    if (!stored || tokenSubject(stored) !== address.toLowerCase()) {
      if (stored) saveToken(null);
      setState((s) => ({ ...s, ready: true }));
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const profile = await fetchProfile(stored);
        if (alive) setState((s) => ({ ...s, token: stored, profile, error: null, ready: true }));
      } catch {
        if (alive) {
          saveToken(null);
          setState((s) => ({ ...s, token: null, profile: null, ready: true }));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [address]);

  // Wallet switched or disconnected → drop a session bound to another address.
  // Always clears a stale spinner: any in-flight flow belongs to the previous
  // address, and a stuck signingIn must never block the new wallet.
  useEffect(() => {
    setState((s) => {
      if (!s.token) return s.signingIn ? { ...s, signingIn: false, error: null } : s;
      const sub = tokenSubject(s.token);
      if (!address || sub !== address.toLowerCase()) {
        saveToken(null);
        return { token: null, profile: null, signingIn: false, error: null, ready: true };
      }
      return s;
    });
  }, [address]);

  // A different wallet is a different user — manual sign-out only suppresses
  // auto sign-in for the wallet that signed out. Reconnecting (same or new
  // wallet) re-arms it; a rejection still never retries (autoTried).
  const lastAddress = useRef<string | null>(null);
  useEffect(() => {
    const lower = address?.toLowerCase() ?? null;
    if (lower !== lastAddress.current) {
      lastAddress.current = lower;
      if (lower !== null) signedOut.current = false;
    }
  }, [address]);

  // Auto sign-in: a fresh wallet connection with no session starts the
  // signature flow immediately (the wallet still prompts once — only the
  // key holder can sign). Skipped after manual sign-out or a rejection.
  // Waits for restore (ready), and never pre-empts a stored session: the
  // restore effect settles those in the same commit (sync check below).
  // If the stored token is dead, restore clears it and this refires.
  // Latest auto-flow id — only the latest flow may write state. Superseded
  // flows stay silent (but must never leave signingIn stuck on).
  const flowRef = useRef(0);
  useEffect(() => {
    if (!state.ready) return;
    if (!address || !client) return;
    if (state.token && tokenSubject(state.token) !== address.toLowerCase()) {
      // Token belongs to another wallet (e.g. a flow that finished after a
      // switch) — drop it and rerun clean rather than sitting on it.
      saveToken(null);
      setState((s) => ({ ...s, token: null, profile: null }));
      return;
    }
    if (state.token || state.signingIn || signedOut.current) return;
    if (autoTried.current.has(address.toLowerCase())) return;
    const stored = loadToken();
    if (stored && tokenSubject(stored) === address.toLowerCase()) return;
    autoTried.current.add(address.toLowerCase());
    const flow = ++flowRef.current;
    let alive = true;
    const mine = () => alive && flowRef.current === flow;
    void (async () => {
      // Aborted flows clear a stale spinner — but only if no newer flow
      // has taken over since.
      const abort = () => {
        if (flowRef.current === flow) {
          setState((s) => (s.signingIn ? { ...s, signingIn: false } : s));
        }
      };
      setState((s) => ({ ...s, signingIn: true, error: null }));
      try {
        const { message } = await requestNonce(address);
        if (!mine()) return abort();
        const signature = await client.signMessage({ account: address, message });
        if (!mine()) return abort();
        const { token, profile } = await verifySignature(address, signature);
        if (!mine()) return abort();
        saveToken(token);
        setState({ token, profile, signingIn: false, error: null, ready: true });
      } catch (e: unknown) {
        if (!mine()) return abort();
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, signingIn: false, error: msg, ready: true }));
      }
    })();
    return () => {
      alive = false;
      // A remount (or dep change) before signing must not consume the
      // one attempt — the next run retries instead of going silent.
      autoTried.current.delete(address.toLowerCase());
    };
    // NOTE: state.signingIn intentionally excluded — the flow sets it, and
    // listing it would self-cancel every run via its own cleanup.
  }, [address, client, state.token, state.ready]);

  const signIn = useCallback(async () => {
    if (!address || !client) throw new Error('Connect a wallet first');
    setState((s) => ({ ...s, signingIn: true, error: null }));
    try {
      const { message } = await requestNonce(address);
      const signature = await client.signMessage({ account: address, message });
      const { token, profile } = await verifySignature(address, signature);
      saveToken(token);
      setState({ token, profile, signingIn: false, error: null, ready: true });
      return { token, profile };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, signingIn: false, error: msg }));
      throw e;
    }
  }, [address, client]);

  const signOut = useCallback(() => {
    saveToken(null);
    signedOut.current = true;
    setState({ token: null, profile: null, signingIn: false, error: null, ready: true });
  }, []);

  const rename = useCallback(
    async (displayName: string) => {
      if (!state.token) throw new Error('Sign in first');
      const profile = await renameProfile(state.token, displayName);
      setState((s) => ({ ...s, profile }));
    },
    [state.token],
  );

  const refresh = useCallback(async () => {
    if (!state.token) return;
    const profile = await fetchProfile(state.token);
    setState((s) => ({ ...s, profile }));
  }, [state.token]);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      signedIn: !!state.token && !!state.profile,
      signIn,
      signOut,
      rename,
      refresh,
    }),
    [state, signIn, signOut, rename, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
