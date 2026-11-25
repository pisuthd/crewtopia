'use client';

import { useEffect, useState } from 'react';
import { Plug, Sparkles } from 'lucide-react';
import ModalShell from '../ModalShell';
import { useSession } from '../SessionContext';
import { getSandboxStatus } from '@/lib/api';
import SkillsTab from './tabs/SkillsTab';
import McpTab from './tabs/McpTab';

type Tab = 'skills' | 'mcp';

const TABS: Array<{ id: Tab; label: string; icon: typeof Plug }> = [
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'mcp', label: 'MCP', icon: Plug },
];

export default function SettingsModal({
  open,
  onClose,
  onAddConnector,
}: {
  open: boolean;
  onClose: () => void;
  onAddConnector: () => void;
}) {
  const { token } = useSession();
  const [tab, setTab] = useState<Tab>('skills');
  const [sandboxLive, setSandboxLive] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab('skills');
    setSandboxLive(null);
    if (!token) return;
    let alive = true;
    getSandboxStatus(token)
      .then((st) => {
        if (alive) setSandboxLive(!!st?.vmLive);
      })
      .catch(() => {
        if (alive) setSandboxLive(false);
      });
    return () => {
      alive = false;
    };
  }, [open, token]);

  return (
    <ModalShell>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" onClick={onClose}>
          <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-wfnavy/50 backdrop-blur-sm" />
          <div
            className="relative flex max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
          >
            <div className="w-40 shrink-0 border-r border-wfnavy/10 bg-wfice/60 p-3">
              <h3 className="px-2 pb-2 font-brico text-base font-bold text-wfnavy">Settings</h3>
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${
                    tab === id ? 'bg-white text-wfnavy shadow-sm' : 'text-wfink hover:text-wfnavy'
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2.2} />
                  {label}
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1 overflow-y-auto">
              {!token ? (
                <p className="p-5 text-sm font-semibold text-wfnavy">Sign in to manage sandbox settings.</p>
              ) : sandboxLive === false ? (
                <p className="p-5 text-sm font-semibold text-wfnavy">
                  Boot your sandbox first — settings live on the team computer.
                </p>
              ) : sandboxLive === null ? (
                <p className="p-5 text-sm text-wfink">Checking sandbox…</p>
              ) : tab === 'skills' ? (
                <SkillsTab token={token} />
              ) : (
                <McpTab
                  token={token}
                  onAdd={() => {
                    onClose();
                    onAddConnector();
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
