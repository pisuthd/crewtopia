'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ModalShell from './ModalShell';

interface DeleteChatModalProps {
  open: boolean;
  botName: string;
  onClose: () => void;
  onDelete: () => Promise<string | null>;
}

export default function DeleteChatModal({ open, botName, onClose, onDelete }: DeleteChatModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) setError(null);
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const confirm = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    const err = await onDelete();
    setDeleting(false);
    if (err) setError(err);
  };

  return (
    <ModalShell>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-wfnavy/40 p-6"
            onClick={onClose}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
              role="alertdialog"
              aria-modal="true"
              aria-label={`Delete ${botName} chat`}
            >
              <div className="p-5">
                <h3 className="font-brico text-lg font-bold text-wfnavy">Delete {botName}?</h3>
                <p className="mt-1 text-sm text-wfink">
                  This removes {botName} and its chat history. This can&apos;t be undone.
                </p>
                {error && (
                  <p className="mt-2 text-sm font-medium text-red-600" role="alert">
                    {error}
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={onClose}
                    className="rounded-full px-5 py-2 text-sm font-semibold text-wfink hover:bg-wfice"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void confirm()}
                    disabled={deleting}
                    className="rounded-full bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalShell>
  );
}
