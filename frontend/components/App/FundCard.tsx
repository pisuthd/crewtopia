'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useWallet } from './WalletContext';
import { useSession } from './SessionContext';
import {
  a2aSend,
  approveU,
  bindMessage,
  explorerTx,
  fundJob,
  getUBalance,
  parseStatus,
} from '@/lib/escrow';
import { getLiveTeam, getPendingRent } from '@/lib/api';

export interface PendingRent {
  taskId: string;
  contextId: string;
  team: string;
  brief: string;
  minutes: number;
  chunks: number;
  totalU: string;
  totalWei: string;
  token: string;
  status: string;
  jobId: string | null;
  /** Top-up on a live rental: same task, clock extends on fund. */
  renewal?: boolean;
  baselineFundedSeconds?: number;
  /** On-chain status of jobId (when known) — a FUNDED job must never fund again. */
  jobStatus?: string | null;
}

type Phase = 'quote' | 'binding' | 'accepting' | 'approving' | 'funding' | 'confirming' | 'working' | 'done-accepted';

interface FundCardProps {
  pending: PendingRent;
  onFunded: () => void;
  onCleared: () => void;
}

/**
  * In-chat escrow funding for a hire quote. Flow mirrors
 * scripts/e2e/cold-buyer.ts: bind-sign → accept (jobId) → approve → fund →
 * poll status until WORKING (server auto-boots the sandbox there).
 */
export default function FundCard({ pending, onFunded, onCleared }: FundCardProps) {
  const { address, client } = useWallet();
  const { token } = useSession();
  const [phase, setPhase] = useState<Phase>(pending.jobId ? 'done-accepted' : 'quote');
  const [jobId, setJobId] = useState<string | null>(pending.jobId);
  const [tx, setTx] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Already funded on-chain (card reopened after funding, or a stale pending):
  // never offer fund again — fund() reverts WrongStatus on funded jobs.
  // Just watch for the flip/credit instead.
  const alreadyFunded = !!jobId && pending.jobStatus === 'FUNDED';
  useEffect(() => {
    if (!alreadyFunded || !token || pollRef.current) return;
    if (pending.renewal) {
      pollUntilCredited(pending.taskId, pending.baselineFundedSeconds ?? 0);
    } else {
      pollUntilWorking(pending.taskId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyFunded]);

  useEffect(() => {
    if (address) getUBalance(address).then(setBalance).catch(() => {});
  }, [address]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const pollUntilCredited = (taskId: string, baseline: number) => {
    setPhase('confirming');
    let tries = 0;
    pollRef.current = setInterval(() => {
      tries += 1;
      void getLiveTeam(token!)
        .then((crews) => {
          const crew = crews.find((c) => c.taskId === taskId);
          if (crew && crew.fundedSeconds > baseline) {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase('working');
            onFunded();
          } else if (tries >= 20) {
            if (pollRef.current) clearInterval(pollRef.current);
            setError('Funded but the extra time is not credited yet — the chain read lags. Wait a minute, then check the clock in the sidebar.');
            setPhase('confirming');
          }
        })
        .catch((e) => {
          if (tries >= 20) {
            if (pollRef.current) clearInterval(pollRef.current);
            setError(e instanceof Error ? e.message : String(e));
          }
        });
    }, 15000);
  };

  const pollUntilWorking = (taskId: string) => {
    setPhase('confirming');
    let tries = 0;
    pollRef.current = setInterval(() => {
      tries += 1;
      void a2aSend({ skill: 'web3-task-status', task_id: taskId })
        .then(({ text }) => {
          if (parseStatus(text) === 'working') {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase('working');
            onFunded();
          } else if (tries >= 20) {
            if (pollRef.current) clearInterval(pollRef.current);
              setError('Funded but not WORKING yet — the chain read lags. Wait a minute, then check the crew chat for status.');
            setPhase('confirming');
          }
        })
        .catch((e) => {
          if (tries >= 20) {
            if (pollRef.current) clearInterval(pollRef.current);
            setError(e instanceof Error ? e.message : String(e));
          }
        });
    }, 15000);
  };

  const handleFund = async () => {
    if (!client || !address) {
      setError('Connect a wallet first.');
      return;
    }
    setError(null);
    try {
      let jid = jobId;
      if (!jid) {
        // 1. Bind: prove wallet ownership (EIP-191, gasless).
        setPhase('binding');
        const nonce = `app-${Date.now()}`;
        const sig = await client.signMessage({ message: bindMessage(address, nonce), account: address });
        // 2. Accept: server creates the escrow job.
        setPhase('accepting');
        try {
          const { artifacts } = await a2aSend({
            skill: 'accept-web3-quote',
            task_id: pending.taskId,
            buyerAddress: address,
            nonce,
            buyerSig: sig,
          });
          const escrow = artifacts.find((a: any) => a?.name === 'escrow')?.parts?.[0]?.data;
          if (!escrow?.jobId) throw new Error('accept did not return a jobId');
          jid = String(escrow.jobId);
      } catch (acceptErr) {
        // Accept runs 3 on-chain txs and can outlive the 29s gateway limit —
        // the job is usually created anyway. Recover it instead of dying.
        if (token) {
          const again = await getPendingRent(token).catch(() => null);
          if (again?.jobId && again.taskId === pending.taskId) {
            jid = again.jobId;
          } else if (pending.renewal) {
            // Renewal jobs live on the working task, not in pending — read it there.
            const crews = await getLiveTeam(token).catch(() => []);
            const rj = crews.find((c) => c.taskId === pending.taskId)?.renewalJobId;
            if (rj) jid = rj;
          }
        }
        if (!jid) throw acceptErr;
      }
        setJobId(jid);
        setPhase('done-accepted');
      }
      // 3. Approve U (only what the escrow needs).
      setPhase('approving');
      const amount = BigInt(pending.totalWei);
      await approveU(client, address, amount);
      // 4. Fund on-chain.
      setPhase('funding');
      const hash = await fundJob(client, address, BigInt(jid!), amount);
      setTx(hash);
      getUBalance(address).then(setBalance).catch(() => {});
      // 5. Renewals credit onto the live clock (already WORKING); fresh hires
      // wait for the WORKING flip (lazy on-chain verification flips it, auto-boot fires).
      if (pending.renewal) {
        pollUntilCredited(pending.taskId, pending.baselineFundedSeconds ?? 0);
      } else {
        pollUntilWorking(pending.taskId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Phase-aware wording: the label already says where it stopped, the
      // message says why. Never surface raw TypeErrors.
      const friendly = /denied|rejected|user/i.test(msg)
        ? 'Signature rejected in wallet — no funds moved.'
        : /Failed to fetch|NetworkError|network/i.test(msg)
          ? 'Connection lost mid-step — nothing confirmed onchain. Retry and the card picks up where it stopped.'
          : msg;
      setError(friendly);
      setPhase(jobId ? 'done-accepted' : 'quote');
    }
  };

  if (phase === 'working') {
    return (
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        <p className="flex items-center gap-1.5 font-bold">
          <Check className="h-4 w-4" strokeWidth={2.5} /> {pending.renewal ? 'Extended — clock extended' : 'Funded — sandbox booting'}
        </p>
        <p className="mt-1">
          {pending.team} · {pending.minutes} min · {pending.totalU} $U escrowed.{' '}
          {pending.renewal ? 'The crew keeps going — chat to continue.' : 'The sandbox boots automatically — ask the crew for the preview link whenever you want to see it.'}
        </p>
        <button onClick={onCleared} className="mt-2 text-xs font-semibold underline hover:no-underline">
          Dismiss
        </button>
      </div>
    );
  }

  const busy = !['quote', 'done-accepted'].includes(phase);
  const phaseLabel: Record<string, string> = {
    binding: 'Sign the binding in your wallet…',
    accepting: 'Creating the escrow job…',
    approving: 'Approving $U in your wallet…',
    funding: 'Sign the fund transaction…',
    confirming: 'Confirming on-chain…',
  };

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-wfcta/40 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-wfcta">{pending.renewal ? 'Extend — fund to continue' : 'Rental quote — fund to start'}</p>
      <p className="mt-1 font-brico text-lg font-bold text-wfnavy">
        {pending.team} · {pending.minutes} min
      </p>
      <p className="text-sm text-wfink">
        {pending.chunks} × 6-min chunks · <span className="font-bold text-wfnavy">{pending.totalU} $U</span>
        {pending.brief ? ` · “${pending.brief.slice(0, 80)}”` : ''}
      </p>
      <p className="mt-1 font-mono text-[11px] text-wfink" title={pending.taskId}>
        task {pending.taskId.slice(0, 8)}…{jobId ? ` · job ${jobId}` : ''}
        {balance !== null ? ` · your $U: ${balance}` : ''}
      </p>
      {tx && (
        <p className="mt-1 text-xs">
          <a href={explorerTx(tx)} target="_blank" rel="noreferrer" className="font-semibold text-wfcta underline hover:no-underline">
            {tx.slice(0, 10)}…{tx.slice(-8)}
          </a>
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <button
        onClick={() => void handleFund()}
        disabled={busy || alreadyFunded}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-wfnavy py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
        {busy ? (phaseLabel[phase] ?? 'Working…') : alreadyFunded ? 'Already funded — waiting for confirmation…' : jobId ? `Fund ${pending.totalU} $U (job ${jobId})` : `Fund ${pending.totalU} $U`}
      </button>
    </div>
  );
}
