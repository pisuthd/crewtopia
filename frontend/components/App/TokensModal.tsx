'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Coins, Droplets, Wallet, X } from 'lucide-react';
import ModalShell from './ModalShell';
import WalletModal from './WalletModal';
import { useWallet } from './WalletContext';
import { getFaucetState, requestTestTokens, waitForClaim, explorerTx, txSeen, type FaucetState } from '@/lib/tokens';

interface TokensModalProps {
  open: boolean;
  onClose: () => void;
}

type Phase = 'checking' | 'ready' | 'requesting' | 'confirming' | 'done';

export default function TokensModal({ open, onClose }: TokensModalProps) {
  const { address, client, isConnected } = useWallet();
  const [walletOpen, setWalletOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('checking');
  const [state, setState] = useState<FaucetState | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fresh faucet read every time the modal opens for a connected wallet.
  useEffect(() => {
    if (!open || !address) return;
    let alive = true;
    setPhase('checking');
    setState(null);
    setTx(null);
    setError(null);
    getFaucetState(address)
      .then((s) => {
        if (alive) {
          setState(s);
          setPhase('ready');
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : 'Could not read the faucet.');
          setPhase('ready');
        }
      });
    return () => {
      alive = false;
    };
  }, [open, address]);

  const handleRequest = async () => {
    if (!client || !address) return;
    setPhase('requesting');
    setError(null);
    setTx(null);
    let hash: `0x${string}`;
    try {
      hash = await requestTestTokens(client, address);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /revert|denied|cooldown|allowed|already/i.test(msg)
          ? 'Faucet cooling down (~30 min between claims) — try again later. No funds moved.'
          : msg,
      );
      setPhase('ready');
      return;
    }
    // Broadcast succeeded — show the hash immediately so a slow confirmation
    // can never look like "nothing happened".
    setTx(hash);
    // …but only trust it once a node actually sees it (wallets sometimes
    // return phantom hashes they never broadcast).
    let seen = await txSeen(hash);
    for (let i = 0; i < 5 && !seen; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      seen = await txSeen(hash);
    }
    if (!seen) {
      setError('Wallet returned a hash the network never saw — check the wallet is on BNB Testnet (testnets enabled), then retry. No funds moved.');
      setPhase('ready');
      return;
    }
    setPhase('confirming');
    try {
      await waitForClaim(hash);
      setPhase('done');
      getFaucetState(address).then(setState).catch(() => {});
    } catch {
      setError('Submitted, but no confirmation within 90s — check the explorer link before retrying.');
      setPhase('ready');
    }
  };

  return (
    <ModalShell>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <motion.button
              aria-label="Close"
              onClick={onClose}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-wfnavy/50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', damping: 22, stiffness: 300 }}
              className="relative w-full max-w-md rounded-2xl border border-wfnavy/10 bg-white p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-label="Request test $U"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-brico text-lg font-bold text-wfnavy">Request test $U</h2>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-wfink hover:bg-wfice hover:text-wfnavy"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>

              {!isConnected ? (
                <div className="mt-4 text-center">
                  <div className="mx-auto w-fit rounded-2xl bg-wfice p-4">
                    <Coins className="h-8 w-8 text-wfcta" strokeWidth={2} />
                  </div>
                  <p className="mt-3 text-sm text-wfink">
                    Connect your BNB Testnet wallet to claim free test $U from the faucet.
                  </p>
                  <button
                    onClick={() => setWalletOpen(true)}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-wfnavy py-2.5 text-sm font-bold text-white hover:opacity-90"
                  >
                    <Wallet className="h-4 w-4" strokeWidth={2.2} />
                    Connect wallet
                  </button>
                </div>
              ) : phase === 'checking' ? (
                <p className="mt-4 animate-pulse text-center text-sm text-wfink">Reading the faucet…</p>
              ) : (
                <div className="mt-4">
                  <div className="rounded-2xl border border-wfnavy/10 bg-wfthread p-5 text-center">
                    <div className="mx-auto w-fit rounded-2xl bg-white p-3 shadow-sm">
                      <Droplets className="h-7 w-7 text-wfcta" strokeWidth={2} />
                    </div>
                    <p className="mt-3 font-brico text-xl font-bold text-wfnavy">
                      {state ? `${state.balance} $U` : '—'}
                    </p>
                    <p className="text-sm text-wfink">
                      {state ? `Your balance · drip is ${state.drip} $U per claim` : 'BNB Testnet faucet'}
                    </p>
                  </div>
                  {(phase === 'done' || phase === 'confirming') && tx && (
                    <p className="mt-3 text-center text-sm font-semibold text-wfnavy">
                      {phase === 'done' ? (
                        <span className="inline-flex items-center gap-1.5 text-green-700">
                          <Check className="h-4 w-4" strokeWidth={2.5} /> Claimed —{' '}
                        </span>
                      ) : (
                        'Submitted, confirming… '
                      )}
                      <a
                        href={explorerTx(tx)}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:no-underline"
                      >
                        {tx.slice(0, 10)}…{tx.slice(-8)}
                      </a>
                    </p>
                  )}
                  {error && (
                    <p className="mt-3 text-center text-sm font-medium text-red-600" role="alert">
                      {error}
                    </p>
                  )}
                  <button
                    onClick={() => void handleRequest()}
                    disabled={phase === 'requesting' || phase === 'confirming'}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-wfnavy py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <Droplets className="h-4 w-4" strokeWidth={2.2} />
                    {phase === 'requesting'
                      ? 'Check your wallet…'
                      : phase === 'confirming'
                        ? 'Confirming on-chain…'
                        : 'Request test $U'}
                  </button>
                  <p className="mt-2 text-center text-xs text-wfink">
                    Needs a little tBNB for gas · ~30 min cooldown between claims
                  </p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </ModalShell>
  );
}
