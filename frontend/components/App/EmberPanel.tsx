'use client';

import { useEffect, useState } from 'react';
import { Power, Trash2, X } from 'lucide-react';
import Hexbot from '../Hexbot';
import DeleteChatModal from './DeleteChatModal';
import { useSession } from './SessionContext';
import { assignAssistant, deleteChatHistory, getLiveTeam, terminateSandbox, type LiveCrew } from '@/lib/ember';
import type { MockBot } from './mockTeam';

interface EmberPanelProps {
  open: boolean;
  onClose: () => void;
  bot: MockBot;
  onDeleted: () => void;
}

export default function EmberPanel({ open, onClose, bot, onDeleted }: EmberPanelProps) {
  const { token, refresh } = useSession();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [crews, setCrews] = useState<LiveCrew[] | null>(null);
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);

  const loadCrews = async () => {
    if (!token) return;
    try {
      setCrews(await getLiveTeam(token));
    } catch {
      setCrews([]);
    }
  };

  useEffect(() => {
    if (open) {
      setConfirmTerminate(false);
      setSandboxError(null);
      void loadCrews();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token]);

  const handleDelete = async (): Promise<string | null> => {
    if (!token) return 'No session — reconnect your wallet.';
    try {
      await deleteChatHistory(token, bot.id);
      await assignAssistant(token, null);
      await refresh();
    } catch (e) {
      return e instanceof Error ? e.message : 'Delete failed.';
    }
    setDeleteOpen(false);
    onDeleted();
    onClose();
    return null;
  };

  const handleTerminate = async () => {
    if (!token || !crews?.[0]) return;
    if (!confirmTerminate) {
      setConfirmTerminate(true);
      return;
    }
    setBusy(true);
    setSandboxError(null);
    try {
      await terminateSandbox(token, crews[0].taskId);
      await loadCrews();
    } catch (e) {
      setSandboxError(e instanceof Error ? e.message : 'Terminate failed.');
    } finally {
      setBusy(false);
      setConfirmTerminate(false);
    }
  };

  const crew = crews?.[0] ?? null;

  return (
    <div
      className={`shrink-0 overflow-hidden border-wfnavy/10 bg-wfice transition-all duration-200 ${
        open ? 'fixed inset-y-0 right-0 z-30 w-80 border-l md:static' : 'w-0'
      }`}
      aria-hidden={!open}
    >
      <div className="flex h-full w-80 flex-col p-5">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setDeleteOpen(true)}
            aria-label="Delete Ember"
            title="Delete Ember"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-red-600 shadow-sm hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <button
            onClick={onClose}
            aria-label="Close assistant info"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-wfnavy shadow-sm hover:bg-slate-50"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>

        <div className="mx-auto mt-5 w-fit">
          <Hexbot color={bot.color} size="lg" role={bot.hexRole} label={`${bot.name} hexbot`} />
        </div>

        <p className="mt-5 truncate text-center text-lg font-bold text-wfnavy">
          {bot.name} <span className="text-sm font-medium text-wfink">· {bot.role}</span>
        </p>

        <div className="mt-5 flex min-h-0 flex-1 flex-col" role="tablist" aria-label="Assistant sections">
          <div className="grid grid-cols-1 gap-1 rounded-full bg-white p-1 shadow-sm">
            <span role="tab" aria-selected className="rounded-full bg-wfnavy py-1.5 text-center text-xs font-bold text-white">
              Sandbox
            </span>
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto" role="tabpanel">
            {crews === null ? (
              <p className="animate-pulse rounded-xl bg-white px-3 py-4 text-center text-sm text-wfink shadow-sm">
                Checking sandbox…
              </p>
            ) : !crew ? (
              <p className="rounded-xl bg-white px-3 py-4 text-center text-sm text-wfink shadow-sm">
                No live sandbox. Fund a rental and the crew&apos;s sandbox shows up here.
              </p>
            ) : (
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="flex items-center gap-1.5 text-sm font-bold text-wfnavy">
                  <span className={`h-1.5 w-1.5 rounded-full ${crew.vmLive ? 'bg-green-500' : crew.vmSuspended ? 'bg-amber-500' : 'bg-slate-300'}`} />
                  {crew.team}
                </p>
                <p className="mt-1 text-xs text-wfink">
                  {crew.status} · {crew.minutesLeft} min left
                  {crew.vmSuspended ? ' · parked (files kept)' : crew.vmLive ? ' · running' : ' · booting'}
                </p>
                {crew.brief && <p className="mt-2 text-xs text-wfink">“{crew.brief.slice(0, 100)}”</p>}
                {sandboxError && (
                  <p className="mt-2 text-xs font-medium text-red-600" role="alert">
                    {sandboxError}
                  </p>
                )}
                <button
                  onClick={() => void handleTerminate()}
                  disabled={busy || !crew.vmLive}
                  className={`mt-3 flex w-full items-center justify-center gap-2 rounded-full py-2 text-sm font-bold transition disabled:opacity-40 ${
                    confirmTerminate
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-wfnavy/10 text-wfnavy hover:bg-wfnavy/20'
                  }`}
                >
                  <Power className="h-4 w-4" strokeWidth={2.2} />
                  {busy ? 'Terminating…' : confirmTerminate ? 'Confirm terminate' : 'Shut down sandbox'}
                </button>
                <p className="mt-1.5 text-center text-[11px] text-wfink">
                  Destroys the sandbox and its files. Hire again to start fresh.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      <DeleteChatModal
        open={deleteOpen}
        botName={bot.name}
        onClose={() => setDeleteOpen(false)}
        onDelete={handleDelete}
      />
    </div>
  );
}
