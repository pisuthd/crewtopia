'use client';

import { useEffect, useState } from 'react';
import { Menu, PanelRight, PhoneCall } from 'lucide-react';
import Link from 'next/link';
import Hexbot from '../Hexbot';
import MemberChat from './MemberChat';
import BotPanel from './BotPanel';
import RatingCard from './RatingCard';
import type { MemberMeta } from './crew';
import type { LiveCrew } from '@/lib/api';
import { loadPendingFeedback, type PendingFeedback } from '@/lib/feedback';

const TEAM_DISPLAY: Record<string, string> = { 'dev-crew': 'Dev Crew', 'voice-crew': 'Voice Crew' };

interface TeamViewProps {
  memberTaskId: string | null;
  memberRole: string | null;
  memberMeta: MemberMeta | null;
  roster: { role: string; name: string; title: string }[];
  crew: LiveCrew | null;
  onOpenSidebar: () => void;
  onFundMore: () => void;
}

export default function TeamView({ memberTaskId, memberRole, memberMeta, roster, crew, onOpenSidebar, onFundMore }: TeamViewProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [pending, setPending] = useState<PendingFeedback | null>(null);
  // Post-rental rating: crews vanish from /rent/team once ended, so the
  // pending prompt (saved at end-rental) is the trigger, not live state.
  useEffect(() => {
    setPending(crew ? null : loadPendingFeedback());
  }, [crew]);
  // Voice entry: voice crews only, and only on ticked-mic threads (concierge by default).
  const canTalk =
    !!memberTaskId &&
    !!memberRole &&
    crew?.teamId === 'voice-crew' &&
    crew?.status === 'working' &&
    (crew?.speakRoles ?? []).includes(memberRole);
  return (
    <div className="flex min-w-0 flex-1">
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
        {memberMeta && memberTaskId && memberRole ? (
          <button
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
            aria-label="Bot panel"
            className="mx-auto flex items-center gap-2.5 rounded-full bg-white py-2 pl-3 pr-5 font-bold text-wfnavy shadow-md shadow-wfnavy/5 transition hover:bg-slate-50"
          >
            <Hexbot color={memberMeta.color} size="xs" role={memberMeta.hexRole} label={`${memberMeta.name} hexbot`} />
            <span>{memberMeta.name}</span>
            <span className="hidden text-sm font-medium text-wfink sm:inline">
              · {memberMeta.title}
            </span>
          </button>
        ) : (
          <div className="mx-auto" />
        )}
        <span className="w-9 md:hidden" />
        <span className="hidden w-40 md:flex md:items-center md:justify-end md:gap-2">
          {canTalk && memberTaskId && (
            <Link
              href={`/voice/${memberTaskId}`}
              aria-label="Open voice call"
              title="Talk to the crew by voice"
              className="grid h-9 w-9 place-items-center rounded-full bg-wfcta text-white shadow-sm hover:opacity-90"
            >
              <PhoneCall className="h-4 w-4" strokeWidth={2.2} />
            </Link>
          )}
          {memberMeta && memberTaskId && memberRole ? (
            <button
              onClick={() => setPanelOpen((o) => !o)}
              aria-label="Bot panel"
              aria-expanded={panelOpen}
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-wfnavy shadow-sm hover:bg-slate-50"
            >
              <PanelRight className="h-4 w-4" strokeWidth={2.2} />
            </button>
          ) : null}
        </span>
        <span className="grid h-9 w-9 place-items-center md:hidden">
          {canTalk && memberTaskId && (
            <Link
              href={`/voice/${memberTaskId}`}
              aria-label="Open voice call"
              className="grid h-9 w-9 place-items-center rounded-full bg-wfcta text-white shadow-sm"
            >
              <PhoneCall className="h-4 w-4" strokeWidth={2.2} />
            </Link>
          )}
        </span>
        </header>

        {memberMeta && memberTaskId && memberRole ? (
          <MemberChat
            taskId={memberTaskId}
            role={memberRole}
            name={memberMeta.name}
            title={memberMeta.title}
            color={memberMeta.color}
            hexRole={memberMeta.hexRole}
            description={memberMeta.description}
            roster={roster}
            onFundMore={onFundMore}
          />
        ) : (
          <div className="grid flex-1 place-items-center gap-4 overflow-y-auto px-6 py-8">
            {pending && (
              <RatingCard
                taskId={pending.taskId}
                teamId={pending.teamId}
                teamName={TEAM_DISPLAY[pending.teamId] ?? 'the crew'}
                onDone={() => setPending(null)}
              />
            )}
            <div className="max-w-sm text-center">
              <p className="font-brico text-xl font-bold text-wfnavy">No member selected</p>
              <p className="mt-1 text-sm text-wfink">
                Pick a crew member from the roster to start.
              </p>
            </div>
          </div>
        )}
      </main>
      {memberMeta && memberTaskId && memberRole && (
        <BotPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          taskId={memberTaskId}
          role={memberRole}
          meta={memberMeta}
          crew={crew}
        />
      )}
    </div>
  );
}
