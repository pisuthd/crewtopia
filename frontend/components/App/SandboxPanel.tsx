'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Power, SquareTerminal, Trash2, X } from 'lucide-react';
import ModalShell from './ModalShell';
import TerminalModal from './Terminal/TerminalModal';
import { useSession } from './SessionContext';
import {
  bootSandbox,
  getSandboxStatus,
  getSandboxToken,
  terminateSandbox,
  type SandboxStatus,
} from '@/lib/api';

interface SandboxPanelProps {
  open: boolean;
  onClose: () => void;
  status: SandboxStatus | null;
  onChanged: () => void;
}

function short(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
}

export default function SandboxPanel({ open, onClose, status, onChanged }: SandboxPanelProps) {
  const { token } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [termOpen, setTermOpen] = useState(false);
  const [termAuth, setTermAuth] = useState<{ endpoint: string; authToken: string } | null>(null);
  const [termError, setTermError] = useState<string | null>(null);
  // Live view: snapshot prop goes stale the moment boot is accepted
  // (fire-and-forget 202 + async provision), so poll while open.
  const [polled, setPolled] = useState<SandboxStatus | null>(null);
  const [bootedAt, setBootedAt] = useState<number | null>(null);

  useEffect(() => {
      if (!open) {
      setError(null);
      setTermOpen(false);
      setTermAuth(null);
      setTermError(null);
      setPolled(null);
      return;
    }
    if (!token) return;
    let stopped = false;
    const poll = async () => {
      const s = await getSandboxStatus(token).catch(() => null);
      if (stopped || !s) return;
      setPolled((prev) => {
        if (prev?.state !== s.state) console.debug('[sandbox] status', prev?.state ?? '—', '→', s.state);
        return s;
      });
      if (s.vmLive) setBootedAt(null);
      onChanged();
    };
    void poll();
    const t = setInterval(() => void poll(), 10000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [open, token, onChanged]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    if (!token) return;
    setBusy(label);
    setError(null);
    try {
      await fn();
      console.debug(`[sandbox] ${label} accepted`);
      if (label === 'boot') setBootedAt(Date.now());
      if (label === 'terminate') {
        setBootedAt(null);
        setPolled(null);
      }
      await getSandboxStatus(token).catch(() => null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  const openTerminal = async () => {
    if (!token) return;
    setBusy('terminal');
    setTermError(null);
    try {
      const t = await getSandboxToken(token);
      setTermAuth(t);
      setTermOpen(true);
    } catch (e) {
      setTermError(e instanceof Error ? e.message : 'Could not mint a terminal token.');
    } finally {
      setBusy(null);
    }
  };

  const view = polled ?? status;
  const live = view?.vmLive ?? false;
  const state = view?.state ?? 'none';
  // Boot accepted but the async provisioner hasn't reported yet (or is
  // still working): show progress instead of a stale snapshot.
  const booting = !live && (state === 'booting' || (bootedAt !== null && Date.now() - bootedAt < 6 * 60_000));

  return (
    <ModalShell>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-wfnavy/60 p-4"
            onClick={onClose}
          >
            <motion.div
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Sandbox info"
            >
              <div className="flex items-center justify-between px-5 py-4">
                <p className="font-brico text-lg font-bold text-wfnavy">Sandbox</p>
                <button
                  onClick={onClose}
                  aria-label="Close sandbox panel"
                  className="grid h-9 w-9 place-items-center rounded-full bg-wfice text-wfnavy hover:bg-slate-100"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>
              <div className="space-y-2 px-5 pb-2 text-sm text-wfnavy">
                <div className="flex justify-between gap-4">
                  <span className="text-wfink">State</span>
                  <span className="font-bold">{state}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-wfink">Computer</span>
                  <span className="text-xs">Linux MicroVM</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-wfink">VM</span>
                  <span className="font-mono text-xs">{short(view?.vmId)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-wfink">Booted</span>
                  <span className="text-xs">{view?.bootedAt ? new Date(view.bootedAt).toLocaleString() : '—'}</span>
                </div>
              </div>
              {booting && (
                <div className="mx-5 mb-1 flex items-center gap-2 rounded-xl bg-wfice px-3 py-2.5 text-xs font-semibold text-wfnavy">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Booting your sandbox… usually a few minutes. You can close this panel — it will be live when you come back.
                </div>
              )}
              {error && <p className="px-5 pt-2 text-sm text-red-600">{error}</p>}
              <div className="grid grid-cols-2 gap-2 px-5 py-4">
                <button
                  onClick={() => void run('boot', () => bootSandbox(token!))}
                  disabled={busy !== null || live || booting}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-wfnavy px-3 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                >
                  {busy === 'boot' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                  Boot
                </button>
                <button
                  onClick={() => void run('terminate', () => terminateSandbox(token!, ''))}
                  disabled={busy !== null || (!live && !view?.vmSuspended)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 px-3 py-2.5 text-sm font-semibold text-red-600 disabled:opacity-40"
                >
                  {busy === 'terminate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Terminate
                </button>
              </div>
              <div className="px-5 pb-5">
                <button
                  onClick={() => void openTerminal()}
                  disabled={busy !== null || !live}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cta px-3 py-3 text-sm font-bold text-navy disabled:opacity-40"
                >
                  {busy === 'terminal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquareTerminal className="h-4 w-4" />}
                  Open terminal
                </button>
                <p className="pt-2 text-center text-xs text-wfink">
                  Your sandbox boots itself when you hire a team. Boot early to get going faster.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <TerminalModal
        open={termOpen}
        onClose={() => {
          setTermOpen(false);
          setTermAuth(null);
        }}
        endpoint={termAuth?.endpoint ?? null}
        authToken={termAuth?.authToken ?? null}
        tokenError={termError}
      />
    </ModalShell>
  );
}
