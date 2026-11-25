'use client';

import { useCallback, useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import TeamModal from './TeamModal';
import AddMemberModal from './AddMemberModal';
import TeamView from './TeamView';
import { useSession } from './SessionContext';
import { getLiveTeam, type LiveCrew } from '@/lib/api';
import { memberMetaFor, type MemberMeta } from './crew';

interface AppShellProps {
  promptTokens?: boolean;
}

export default function AppShell({ promptTokens }: AppShellProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const { token, signedIn } = useSession();
  const [rentals, setRentals] = useState<LiveCrew[]>([]);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [renewTask, setRenewTask] = useState<LiveCrew | null>(null);

  const refreshRentals = useCallback(async () => {
    if (!token) {
      setRentals([]);
      return;
    }
    try {
      setRentals(await getLiveTeam(token));
    } catch {
      // keep stale list on failure
    }
  }, [token]);

  useEffect(() => {
    void refreshRentals();
  }, [refreshRentals]);

  // Tick minutes-left while signed in.
  useEffect(() => {
    if (!signedIn) return;
    const t = setInterval(() => void refreshRentals(), 30000);
    return () => clearInterval(t);
  }, [signedIn, refreshRentals]);

  // Live member selection: ids look like m:{taskId}:{role}.
  const memberSel = selectedId?.startsWith('m:') ? selectedId.slice(2).split(':') : null;
  const memberTaskId = memberSel && memberSel.length >= 2 ? memberSel[0] : null;
  const memberRole = memberSel && memberSel.length >= 2 ? memberSel[memberSel.length - 1] : null;
  const crew = memberTaskId ? (rentals.find((r) => r.taskId === memberTaskId) ?? null) : null;
  const minfo = crew && memberRole ? (crew.members.find((m) => m.role === memberRole) ?? null) : null;
  const memberMeta: MemberMeta | null =
    minfo && crew
      ? memberMetaFor(minfo.role, minfo.name, minfo.title, crew.members.indexOf(minfo))
      : memberRole
        ? memberMetaFor(memberRole, memberRole, memberRole)
        : null;

  const openTeams = (renew?: LiveCrew) => {
    setRenewTask(renew ?? null);
    setTeamsOpen(true);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-wfice font-brico text-wfnavy">
      <Sidebar
        selectedId={selectedId}
        promptTokens={promptTokens}
        rentals={rentals}
        onChanged={() => void refreshRentals()}
        onOpenTeams={openTeams}
        onOpenAddMember={() => setAddMemberOpen(true)}
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
      <TeamModal
        open={teamsOpen}
        onClose={() => {
          setTeamsOpen(false);
          setRenewTask(null);
        }}
        onHired={() => {
          setTeamsOpen(false);
          setRenewTask(null);
          void refreshRentals();
        }}
        rentals={rentals}
        renewTask={renewTask}
      />
      <AddMemberModal
        open={addMemberOpen}
        onClose={() => setAddMemberOpen(false)}
        rentals={rentals}
        onChanged={() => void refreshRentals()}
      />
      <TeamView
        memberTaskId={memberTaskId}
        memberRole={memberRole}
        memberMeta={memberMeta}
        roster={crew?.members ?? []}
        crew={crew}
        onOpenSidebar={() => setSideOpen(true)}
        onFundMore={() => {
          if (crew) openTeams(crew);
        }}
      />
    </div>
  );
}
