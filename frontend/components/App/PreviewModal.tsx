'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, Globe, X } from 'lucide-react';
import ModalShell from './ModalShell';

interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  url: string | null;
  loadError: string | null;
}

/** Live dev-server preview (port 5173) through the signed preview proxy. */
export default function PreviewModal({ open, onClose, url, loadError }: PreviewModalProps) {
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
              className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Live preview"
            >
              <div className="flex items-center justify-between border-b border-wfnavy/10 px-5 py-3.5">
                <p className="flex items-center gap-2 font-brico text-sm font-semibold text-wfnavy">
                  <Globe className="h-4 w-4" strokeWidth={2.2} />
                  Live preview
                </p>
                <div className="flex items-center gap-2">
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 rounded-full bg-wfice px-3 py-2 text-xs font-bold text-wfnavy hover:bg-slate-200"
                    >
                      <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.2} />
                      New tab
                    </a>
                  )}
                  <button
                    onClick={onClose}
                    aria-label="Close preview"
                    className="grid h-9 w-9 place-items-center rounded-full bg-wfice text-wfnavy hover:bg-slate-100"
                  >
                    <X className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 bg-wfice/50">
                {url && !loadError ? (
                  <iframe src={url} title="Live preview" className="h-full w-full border-0" sandbox="allow-scripts allow-same-origin allow-forms" />
                ) : (
                  <div className="grid h-full place-items-center px-6 text-center">
                    <div>
                      <p className="font-brico text-lg font-bold text-wfnavy">Preview not ready</p>
                      <p className="mt-1 text-sm text-wfink">
                        {loadError ?? 'Ask the crew to serve the app on port 5173 first.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalShell>
  );
}
