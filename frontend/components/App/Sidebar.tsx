'use client';

import Link from 'next/link';
import { Plus, Search, Users, Wallet } from 'lucide-react';
import Hexbot from '../Hexbot';
import { brandName } from '@/lib/site';
import type { MockBot } from './mockTeam';

interface SidebarProps {
  assistant: MockBot[];
  team: { name: string; members: MockBot[] };
  selectedId: string;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  showSearch: boolean;
  onToggleSearch: () => void;
  open: boolean;
  onClose: () => void;
}

function Section({
  title,
  bots,
  startIndex,
  selectedId,
  onSelect,
}: {
  title: string;
  bots: MockBot[];
  startIndex: number;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (bots.length === 0) return null;
  return (
    <section>
      <p className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-wfink/70">
        {title} · {bots.length}
      </p>
      <div className="space-y-1">
        {bots.map((b, i) => {
          const selected = b.id === selectedId;
          return (
            <button
              key={b.id}
              onClick={() => onSelect(b.id)}
              className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${
                selected ? 'bg-white shadow-sm' : 'hover:bg-white/60'
              }`}
            >
              <Hexbot
                color={b.color}
                size="sm"
                role={b.hexRole}
                blinkDelay={`-${(startIndex + i) * 1.4}s`}
                label={`${b.name} hexbot`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-bold text-wfnavy">
                  <span className="truncate">{b.name}</span>
                  {b.isAssistant && (
                    <span className="shrink-0 rounded-full bg-wfcta/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-wfcta">
                      Assistant
                    </span>
                  )}
                </span>
                <span className="block truncate text-sm text-wfink">{b.role}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function Sidebar({
  assistant,
  team,
  selectedId,
  onSelect,
  query,
  onQuery,
  showSearch,
  onToggleSearch,
  open,
  onClose,
}: SidebarProps) {
  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-20 bg-wfnavy/40 md:hidden ${open ? '' : 'hidden'}`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-[19rem] flex-col border-r border-wfnavy/10 bg-wfice transition-transform md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <Link href="/" aria-label="Back to Crewtopia home" className="flex shrink-0 items-center gap-2.5 rounded-lg">
            <Hexbot color="honey" size="xs" role="pm" blinkDelay="-0.7s" label="Crewtopia hexbot" />
            <span className="font-brico text-lg font-bold text-wfnavy">{brandName()}</span>
          </Link>
          <div className="flex gap-2">
            <button
              onClick={onToggleSearch}
              aria-label="Search team"
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-wfnavy shadow-sm hover:bg-slate-50"
            >
              <Search className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <button
              aria-label="New bot"
              title="Coming soon"
              className="grid h-9 w-9 cursor-not-allowed place-items-center rounded-full bg-white text-wfnavy/40 shadow-sm"
            >
              <Plus className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <button
              aria-label="Start a team"
              title="Coming soon"
              className="grid h-9 w-9 cursor-not-allowed place-items-center rounded-full bg-white text-wfnavy/40 shadow-sm"
            >
              <Users className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>
        </div>

        {showSearch && (
          <div className="px-4 pb-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search my team…"
              className="w-full rounded-xl border border-wfnavy/10 bg-white px-3 py-2 text-sm text-wfnavy outline-none focus:border-wfcta"
            />
          </div>
        )}

        <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-1" aria-label="My team">
          <Section title="My assistant" bots={assistant} startIndex={0} selectedId={selectedId} onSelect={onSelect} />
          <Section title={team.name} bots={team.members} startIndex={assistant.length} selectedId={selectedId} onSelect={onSelect} />
          {assistant.length === 0 && team.members.length === 0 && (
            <p className="px-3 py-4 text-sm text-wfink">No matches.</p>
          )}
        </nav>

        <div className="border-t border-wfnavy/10 p-4">
          {/* TODO: wire to wallet (bnbagent-sdk EVMWalletProvider) */}
          <button
            type="button"
            disabled
            title="Coming soon"
            className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-wfnavy/10 py-2.5 text-sm font-bold text-wfnavy/50"
          >
            <Wallet className="h-4 w-4" strokeWidth={2.2} />
            Connect wallet
          </button>
          <p className="mt-2 text-center text-xs text-wfink">Wallet connection coming soon.</p>
        </div>
      </aside>
    </>
  );
}
