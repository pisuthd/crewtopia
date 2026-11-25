'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useWallet } from './WalletContext';
import ModalShell from './ModalShell';
import type { Wallet } from '@/lib/wallet';

export default function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallets, discover, connect, isConnecting } = useWallet();
  const [busyRdns, setBusyRdns] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      discover();
      setError(null);
    }
  }, [open, discover]);

  const handleConnect = async (w: Wallet) => {
    setBusyRdns(w.info.rdns);
    setError(null);
    try {
      await connect(w);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyRdns(null);
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
              <h2 className="font-brico text-lg font-bold text-wfnavy">Connect wallet</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1.5 text-wfink hover:bg-wfice hover:text-wfnavy"
              >
                <X className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>
            <p className="mt-1 text-sm text-wfink">
              Choose a wallet to continue.
            </p>

            <motion.div
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
              className="mt-4 max-h-80 space-y-2 overflow-y-auto px-1 py-1"
            >
              {wallets.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-dashed border-wfnavy/20 p-6 text-center"
                >
                  <p className="text-sm font-semibold text-wfnavy">No wallet found.</p>
                  <p className="mt-1 text-xs text-wfink">
                    Install MetaMask, Trust Wallet, Rabby, OKX, etc. then refresh.
                  </p>
                  <button
                    onClick={() => discover()}
                    className="mt-3 rounded-lg border border-wfnavy/15 px-3 py-1.5 text-sm font-semibold text-wfnavy hover:bg-wfice"
                  >
                    Rescan
                  </button>
                </motion.div>
              ) : (
                wallets.map((w) => (
                  <motion.button
                    key={w.info.uuid}
                    onClick={() => handleConnect(w)}
                    disabled={isConnecting}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileTap={{ scale: 0.99 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                    className="group flex w-full items-center gap-3 rounded-xl border border-wfnavy/10 bg-white px-4 py-3 text-left transition-colors hover:border-wfcta/50 disabled:opacity-50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={w.info.icon}
                      alt={w.info.name}
                      className="h-8 w-8 shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-wfnavy/10"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-wfnavy">{w.info.name}</div>
                      <div className="truncate text-xs text-wfink">{w.info.rdns}</div>
                    </div>
                    <span className="text-xs font-semibold text-wfink group-hover:text-wfnavy">
                      {busyRdns === w.info.rdns ? 'Connecting…' : 'Connect'}
                    </span>
                  </motion.button>
                ))
              )}
            </motion.div>

            {error && <p className="mt-3 break-words text-xs text-red-600">{error}</p>}

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
    </ModalShell>
  );
}
