'use client';

import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import TeamView from './TeamView';
import { useSession } from './SessionContext';
import { ALL_BOTS, ASSISTANT, CURRENT_TEAM } from './mockTeam';

interface AppShellProps {
  initialId?: string;
  promptAssistant?: boolean;
  promptTokens?: boolean;
}

function matches(query: string, name: string, role: string): boolean {
  return !query || `${name}${role}`.toLowerCase().includes(query.toLowerCase());
}

export default function AppShell({ initialId, promptAssistant, promptTokens }: AppShellProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const { profile, ready } = useSession();
  const emberAssigned = profile?.assistantId === 'ember';

  // Preselect only what the database confirms — never a mock row.
  useEffect(() => {
    if (!ready || selectedId) return;
    if (initialId === 'ember' && emberAssigned) setSelectedId('ember');
  }, [ready, initialId, emberAssigned, selectedId]);

  const assistant = emberAssigned ? [ASSISTANT].filter((b) => matches(query, b.name, b.role)) : [];
  const team = {
    name: CURRENT_TEAM.name,
    members: CURRENT_TEAM.members.filter((b) => matches(query, b.name, b.role)),
  };
  const bot = ALL_BOTS.find((b) => b.id === selectedId) ?? null;
  // Live member selection: ids look like m:{taskId}:{role}.
  const memberSel = selectedId?.startsWith('m:') ? selectedId.slice(2).split(':') : null;
  const memberTaskId = memberSel && memberSel.length >= 2 ? memberSel[0] : null;
  const memberRole = memberSel && memberSel.length >= 2 ? memberSel[memberSel.length - 1] : null;

  return (
    <div className="flex h-screen overflow-hidden bg-wfice font-brico text-wfnavy">
      <Sidebar
        assistant={assistant}
        team={team}
        selectedId={selectedId}
        promptAssistant={promptAssistant}
        promptTokens={promptTokens}
        onSelect={(id) => {
          setSelectedId(id);
          setSideOpen(false);
        }}
        query={query}
        onQuery={setQuery}
        showSearch={showSearch}
        onToggleSearch={() => setShowSearch((s) => !s)}
        open={sideOpen}
        onClose={() => setSideOpen(false)}
      />
      <TeamView
        bot={memberTaskId ? null : bot}
        memberTaskId={memberTaskId}
        memberRole={memberRole}
        onOpenSidebar={() => setSideOpen(true)}
        onDeletedAssistant={() => setSelectedId(null)}
      />
    </div>
  );
}
