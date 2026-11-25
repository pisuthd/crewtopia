'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Blocks, X } from 'lucide-react';
import ModalShell from './ModalShell';

export default function ConnectorsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
              <h2 className="font-brico text-lg font-bold text-wfnavy">Connectors</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1.5 text-wfink hover:bg-wfice hover:text-wfnavy"
              >
                <X className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>
            {/* TODO: real connectors land here */}
            <div className="mt-4 rounded-xl border border-dashed border-wfnavy/20 p-6 text-center">
              <Blocks className="mx-auto h-8 w-8 text-wfink" strokeWidth={1.8} />
              <p className="mt-2 text-sm font-semibold text-wfnavy">No connectors yet.</p>
              <p className="mt-1 text-xs text-wfink">Team integrations land here.</p>
            </div>
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
