'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { useSession } from './SessionContext';
import { useWallet } from './WalletContext';
import {
  clearPendingFeedback,
  isSelfFeedbackError,
  leaveFeedback,
  submitFeedbackTally,
} from '@/lib/feedback';

/** Post-rental rating: stars → onchain giveFeedback → tally. Shown once
 * per ended rental (set at end-rental, cleared on submit/skip). */
export default function RatingCard({
  taskId,
  teamId,
  teamName,
  onDone,
}: {
  taskId: string;
  teamId: string;
  teamName: string;
  onDone: () => void;
}) {
  const { token } = useSession();
  const { client, address } = useWallet();
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  const submit = async () => {
    if (!token || !client || !address || stars < 1 || stars > 5 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await leaveFeedback(client, address as `0x${string}`, teamId, stars, taskId);
      setTx(hash);
      await submitFeedbackTally(token, taskId, hash, stars).catch(() => null);
      clearPendingFeedback();
    } catch (e) {
      if (isSelfFeedbackError(e)) {
        setError('This crew is yours — the protocol only counts buyer ratings, so yours was skipped.');
        clearPendingFeedback();
      } else {
        setError(e instanceof Error ? e.message : 'Rating failed — nothing was recorded.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (tx) {
    return (
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-bold">Thanks — your rating is onchain.</p>
        <p className="mt-1 font-mono text-xs break-all">{tx}</p>
        <button onClick={onDone} className="mt-2 text-xs font-semibold underline hover:no-underline">
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-wfnavy/10 bg-white p-4 shadow-sm">
      <p className="font-brico text-base font-bold text-wfnavy">How did {teamName} do?</p>
      <p className="mt-0.5 text-xs text-wfink">Your stars go onchain to the team&apos;s reputation.</p>
      <div className="mt-2 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            onClick={() => setStars(s)}
            onMouseEnter={() => setHover(s)}
            onMouseLeave={() => setHover(0)}
            aria-label={`Rate ${s} star${s === 1 ? '' : 's'}`}
            className="rounded p-0.5"
          >
            <Star
              className={`h-7 w-7 ${(hover || stars) >= s ? 'fill-amber-400 text-amber-400' : 'text-wfnavy/25'}`}
              strokeWidth={1.8}
            />
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={() => {
            clearPendingFeedback();
            onDone();
          }}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-wfink hover:bg-wfice"
        >
          Skip
        </button>
        <button
          onClick={submit}
          disabled={busy || stars < 1 || !token || !client}
          className="rounded-lg bg-cta px-5 py-2 text-sm font-bold text-white hover:bg-ctahover disabled:opacity-50"
        >
          {busy ? 'Confirm in wallet…' : 'Rate onchain'}
        </button>
      </div>
    </div>
  );
}
