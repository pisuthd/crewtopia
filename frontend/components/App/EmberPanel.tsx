'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import Hexbot from '../Hexbot';
import DeleteChatModal from './DeleteChatModal';
import { useSession } from './SessionContext';
import { assignAssistant, deleteChatHistory } from '@/lib/ember';
import type { MockBot } from './mockTeam';

interface EmberPanelProps {
  open: boolean;
  onClose: () => void;
  bot: MockBot;
  model: string | null;
  onDeleted: () => void;
}

export default function EmberPanel({ open, onClose, bot, model, onDeleted }: EmberPanelProps) {
  const { token, refresh } = useSession();
  const [deleteOpen, setDeleteOpen] = useState(false);

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
        <p className="mt-2 text-center text-sm text-wfink">{bot.description}</p>

        {model && (
          <p className="mx-auto mt-3 w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-wfink shadow-sm">
            {model}
          </p>
        )}
        <p className="mt-3 rounded-xl bg-wfcta/15 px-3 py-2 text-center text-xs font-semibold text-wfnavy">
          Ember is fixed — name and role can&apos;t be edited.
        </p>
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
