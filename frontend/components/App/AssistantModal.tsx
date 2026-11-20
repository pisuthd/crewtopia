'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Sparkles, Wallet, X } from 'lucide-react';
import Hexbot from '../Hexbot';
import ModalShell from './ModalShell';
import WalletModal from './WalletModal';
import { useSession } from './SessionContext';
import { useWallet } from './WalletContext';
import { assignAssistant, getAssistants, type Assistant } from '@/lib/ember';

export default function AssistantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token, signedIn, signingIn, signIn, refresh } = useSession();
  const { isConnected } = useWallet();
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setError(null);
    getAssistants().then(setAssistants).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [open ]);

  const current = assistants[index] ?? null;

  const handleAssign = async () => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      let t = token;
      if (!signedIn || !t) ({ token: t } = await signIn());
      await assignAssistant(t, current.id);
      await refresh();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
            >
              <div className="flex items-center justify-between">
                <h2 className="font-brico text-lg font-bold text-wfnavy">Choose your AI assistant</h2>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-wfink hover:bg-wfice hover:text-wfnavy"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>

              {error && !current ? (
                <p className="mt-4 text-sm text-red-600">{error}</p>
              ) : current ? (
                <div className="mt-4">
                  <div className="flex items-center gap-3">
                    <button
                      aria-label="Previous assistant"
                      disabled={index === 0}
                      onClick={() => setIndex((i) => Math.max(0, i - 1))}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-wfnavy shadow-sm hover:bg-slate-50 disabled:opacity-30"
                    >
                      <ChevronLeft className="h-4 w-4" strokeWidth={2.2} />
                    </button>
                    <div className="min-w-0 flex-1 rounded-2xl border border-wfnavy/10 bg-wfthread p-5 text-center">
                      <div className="mx-auto w-fit">
                        <Hexbot color="honey" size="md" role="pm" label={`${current.name} hexbot`} />
                      </div>
                      <p className="mt-3 font-brico text-xl font-bold text-wfnavy">{current.name}</p>
                      <p className="text-sm font-semibold text-wfcta">{current.role}</p>
                      <p className="mt-2 text-sm text-wfink">{current.description}</p>
                    </div>
                    <button
                      aria-label="Next assistant"
                      disabled={index === assistants.length - 1}
                      onClick={() => setIndex((i) => Math.min(assistants.length - 1, i + 1))}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-wfnavy shadow-sm hover:bg-slate-50 disabled:opacity-30"
                    >
                      <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
                    </button>
                  </div>
                  <p className="mt-2 text-center text-xs text-wfink">
                    {index + 1} of {assistants.length}
                  </p>
                  {error && <p className="mt-2 text-center text-xs text-red-600">{error}</p>}
                  {!isConnected ? (
                    <button
                      onClick={() => setWalletOpen(true)}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-wfnavy py-2.5 text-sm font-bold text-white hover:opacity-90"
                    >
                      <Wallet className="h-4 w-4" strokeWidth={2.2} />
                      Connect wallet
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleAssign()}
                      disabled={busy || signingIn}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-wfnavy py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      <Sparkles className="h-4 w-4" strokeWidth={2.2} />
                      {busy || signingIn ? 'Setting up…' : `Assign ${current.name}`}
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-sm text-wfink">Loading assistants…</p>
              )}

              <div className="mt-4 flex justify-end">
                <button
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-wfink hover:bg-wfice hover:text-wfnavy"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </ModalShell>
  );
}
