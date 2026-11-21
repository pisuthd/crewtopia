'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronUp } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

interface ModelPickerProps {
  /** Live model label from the chat context (e.g. "Muse Ember"). */
  model: string | null;
  disabled?: boolean;
  onChange?: (model: string | null) => void;
}

/**
 * Single-option model pill for the composer utility row. Same affordance as
 * the reference picker (upward dropdown, checked option) — Ember runs one
 * fixed model, so the list has exactly one entry.
 */
export default function ModelPicker({ model, disabled = false, onChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const label = model ?? 'Muse Ember';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative shrink-0">
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.12 }}
              className="absolute bottom-12 left-0 z-50 w-56 overflow-y-auto rounded-2xl border border-wfnavy/10 bg-white p-1.5 shadow-xl"
              role="menu"
              aria-label="Choose model"
            >
              <button
                onClick={() => {
                  onChange?.(model);
                  setOpen(false);
                }}
                role="menuitemradio"
                aria-checked
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-wfice"
              >
                <span className="grid h-4 w-4 shrink-0 place-items-center">
                  <Check className="h-4 w-4 text-wfcta" strokeWidth={2.5} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-wfnavy" title={label}>
                  {label}
                </span>
              </button>
              <p className="px-3 py-1.5 text-[11px] text-wfink">Ember runs on Muse Ember.</p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Model: ${label} — click to view`}
        disabled={disabled}
        className="flex h-7 max-w-44 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 text-wfink hover:bg-slate-200 disabled:opacity-50"
      >
        <span className="truncate text-[11px] font-bold">{label}</span>
        <ChevronUp className={`h-3 w-3 shrink-0 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
    </div>
  );
}
