'use client';

import { useState } from 'react';
import { Menu, PanelRight, Send } from 'lucide-react';
import Hexbot from '../Hexbot';
import EmberChat from './EmberChat';
import EmberPanel from './EmberPanel';
import type { MockBot } from './mockTeam';

interface TeamViewProps {
  bot: MockBot | null;
  onOpenSidebar: () => void;
  onDeletedAssistant: () => void;
}

export default function TeamView({ bot, onOpenSidebar, onDeletedAssistant }: TeamViewProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const isEmber = bot?.id === 'ember';

  return (
    <>
    <main className="flex min-w-0 flex-1 flex-col bg-wfthread">
      <header className="relative flex items-center px-4 py-3.5">
        <button
          onClick={onOpenSidebar}
          aria-label="Open team"
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-wfnavy shadow-sm md:hidden"
        >
          <Menu className="h-4 w-4" strokeWidth={2.2} />
        </button>
        <span className="hidden w-40 md:block" />
        {bot ? (
          isEmber ? (
            <button
              onClick={() => setPanelOpen((o) => !o)}
              aria-expanded={panelOpen}
              aria-label="Assistant info"
              className="mx-auto flex items-center gap-2.5 rounded-full bg-white py-2 pl-3 pr-5 font-bold text-wfnavy shadow-md shadow-wfnavy/5 hover:bg-slate-50"
            >
              <Hexbot color={bot.color} size="xs" role={bot.hexRole} label={`${bot.name} hexbot`} />
              <span>{bot.name}</span>
              <span className="hidden text-sm font-medium text-wfink sm:inline">
                · {bot.role}
              </span>
            </button>
          ) : (
          <div className="mx-auto flex items-center gap-2.5 rounded-full bg-white py-2 pl-3 pr-5 font-bold text-wfnavy shadow-md shadow-wfnavy/5">
            <Hexbot color={bot.color} size="xs" role={bot.hexRole} label={`${bot.name} hexbot`} />
            <span>{bot.name}</span>
            <span className="hidden text-sm font-medium text-wfink sm:inline">
              · {bot.role}
            </span>
          </div>
          )
        ) : (
          <div className="mx-auto" />
        )}
        {isEmber ? (
          <button
            onClick={() => setPanelOpen((o) => !o)}
            aria-label="Assistant info"
            aria-expanded={panelOpen}
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-wfnavy shadow-sm hover:bg-slate-50"
          >
            <PanelRight className="h-4 w-4" strokeWidth={2.2} />
          </button>
        ) : (
          <>
            <span className="w-9 md:hidden" />
            <span className="hidden w-40 md:block" />
          </>
        )}
      </header>

      {bot ? (
        bot.id === 'ember' ? (
          <EmberChat bot={bot} onModel={setModel} />
        ) : (
          <>
            <div className="grid flex-1 place-items-center px-6">
              <div className="max-w-sm text-center">
                <div className="mx-auto mb-4 w-fit">
                  <Hexbot color={bot.color} size="md" role={bot.hexRole} label={`${bot.name} hexbot`} />
                </div>
                <p className="font-brico text-xl font-bold text-wfnavy">{bot.name}</p>
                <p className="mt-1 text-sm text-wfink">{bot.description}</p>
                {/* TODO: thread + composer land here (chat send, history) */}
                <p className="mt-3 text-xs text-wfink">Chat with {bot.name} lands here.</p>
              </div>
            </div>

            <div className="px-4 pb-4">
              <div className="flex items-center gap-2 rounded-2xl border border-wfnavy/10 bg-white px-4 py-3 opacity-60">
                <input
                  disabled
                  placeholder={`Message ${bot.name}… (coming soon)`}
                  className="w-full bg-transparent text-sm text-wfnavy outline-none placeholder:text-wfink"
                />
                <Send className="h-4 w-4 shrink-0 text-wfink" strokeWidth={2.2} />
              </div>
            </div>
          </>
        )
      ) : (
        <div className="grid flex-1 place-items-center px-6">
          <div className="max-w-sm text-center">
            <p className="font-brico text-xl font-bold text-wfnavy">No member selected</p>
            <p className="mt-1 text-sm text-wfink">
              Pick Ember or a Dev Crew member from the roster to start.
            </p>
          </div>
        </div>
      )}
    </main>
    {isEmber && bot && (
      <EmberPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        bot={bot}
        model={model}
        onDeleted={onDeletedAssistant}
      />
    )}
    </>
  );
}
