'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TerminalSquare, X } from 'lucide-react';
import ModalShell from '../ModalShell';
import TerminalView, { type TermMeta } from './TerminalView';

interface TerminalModalProps {
  open: boolean;
  onClose: () => void;
  endpoint: string | null;
  authToken: string | null;
  tokenError: string | null;
}

export default function TerminalModal({ open, onClose, endpoint, authToken, tokenError }: TerminalModalProps) {
  const [meta, setMeta] = useState<TermMeta>({});

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <ModalShell>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-wfnavy/60 p-4 md:p-8"
            onClick={onClose}
          >
            <motion.div
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[#0E1B2C] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Sandbox terminal"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
                <p className="font-brico text-sm font-semibold text-white">Sandbox Terminal</p>
                <button
                  onClick={onClose}
                  aria-label="Close terminal"
                  className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>
              <div className="min-h-0 flex-1 p-2">
                {endpoint && authToken ? (
                  <TerminalView
                    key={`${endpoint}:${authToken.slice(-8)}`}
                    endpoint={endpoint}
                    authToken={authToken}
                    onMeta={(m) => setMeta((prev) => ({ ...prev, ...m }))}
                  />
                ) : (
                  <div className="grid h-full place-items-center px-6">
                    <div className="max-w-sm text-center">
                      <TerminalSquare className="mx-auto h-8 w-8 text-white/40" strokeWidth={1.5} />
                      <p className="mt-4 font-brico text-lg font-bold text-white">Sandbox not ready</p>
                      <p className="mt-2 text-sm leading-relaxed text-white/60">
                        {tokenError ?? 'Boot the sandbox first — the terminal connects once it is running.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-white/10 px-5 py-2.5">
                <p className="font-mono text-[11px] text-white/50">
                  {[meta.cols && meta.rows ? `${meta.cols}×${meta.rows}` : null].filter(Boolean).join(' · ') || '—'}
                </p>
                <p className="text-[11px] text-white/40">Esc to close</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalShell>
  );
}
