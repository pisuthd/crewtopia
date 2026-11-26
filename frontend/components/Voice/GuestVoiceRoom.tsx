'use client';

import { useEffect, useState } from 'react';
import { ConversationProvider } from '@elevenlabs/react';
import { Loader2 } from 'lucide-react';
import { TalkSession } from '@/components/Voice/VoiceRoom';
import { getGuestVoiceConfig, mintGuestVoiceToken } from '@/lib/api';

const DEFAULT_GREETING = 'Hey! I\u2019m Aria \u2014 what can I do for you today?';

export default function GuestVoiceRoom({ linkId }: { linkId: string }) {
  const [cfg, setCfg] = useState<{ team: string; greeting: string | null; minutesLeft: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    getGuestVoiceConfig(linkId)
      .then((c) => {
        if (c.status !== 'working' || c.minutesLeft <= 0) setInvalid(true);
        else setCfg(c);
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [linkId]);

  if (loading) {
    return (
      <main className="grid min-h-screen flex-1 place-items-center bg-wfthread px-6">
        <Loader2 className="h-6 w-6 animate-spin text-wfnavy" />
      </main>
    );
  }
  if (invalid || !cfg) {
    return (
      <main className="grid min-h-screen flex-1 place-items-center bg-wfthread px-6">
        <div className="text-center">
          <p className="font-brico text-xl font-bold text-wfnavy">This voice link is no longer active</p>
          <p className="mt-1 text-sm text-wfink">Ask the business for a fresh link.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col bg-wfthread">
      <header className="px-4 py-3.5 text-center">
        <p className="truncate font-brico text-lg font-bold text-wfnavy">Talk to {cfg.team}</p>
        <p className="text-xs tabular-nums text-wfink">Powered by Crewtopia</p>
      </header>
      <ConversationProvider>
        <TalkSession
          teamName={cfg.team}
          minutesLeft={cfg.minutesLeft}
          greeting={cfg.greeting ?? DEFAULT_GREETING}
          getToken={async () => mintGuestVoiceToken(linkId)}
          flushTarget={{ linkId }}
        />
      </ConversationProvider>
    </main>
  );
}
