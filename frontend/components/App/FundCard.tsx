'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { decodeErrorResult, encodeFunctionData } from 'viem';
import { useWallet } from './WalletContext';
import { useSession } from './SessionContext';
import {
  a2aSend,
  approveU,
  bindMessage,
  createEscrowJob,
  explorerTx,
  fundJob,
  getUAllowance,
  getUBalance,
  parseStatus,
  registerAndBudget,
  simulateFund,
  type JobParams,
} from '@/lib/escrow';
import { getLiveTeam, getPendingRent } from '@/lib/api';
import { tokenSubject } from '@/lib/session';

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
  /** Buyer-side escrow params (issued at accept, before anchoring). */
  jobParams?: JobParams | null;
  /** Top-up on a live rental: same task, clock extends on fund. */
  renewal?: boolean;
  baselineFundedSeconds?: number;
  /** On-chain status of jobId (when known) — a FUNDED job must never fund again. */
  jobStatus?: string | null;
}

type Phase = 'quote' | 'binding' | 'accepting' | 'creating' | 'registering' | 'approving' | 'funding' | 'reporting' | 'confirming' | 'working' | 'done-accepted';

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
  const [debug, setDebug] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const dlog = (line: string) =>
    setDebug((d) => [...d.slice(-49), `${new Date().toISOString().slice(11, 19)} ${line}`]);

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

  // Debug snapshot: who the card thinks is funding what.
  useEffect(() => {
    const bound = token ? tokenSubject(token) : null;
    dlog(`wallet=${address ?? 'none'} bound=${bound ?? 'none'} jobId=${jobId ?? pending.jobId ?? 'none'} task=${pending.taskId.slice(0, 8)} totalWei=${pending.totalWei}`);
    if (address) {
      getUAllowance(address).then((a) => dlog(`allowance U -> escrow: ${a}`)).catch((e) => dlog(`allowance read failed: ${String(e).slice(0, 80)}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, token]);

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
    // The escrow job must be anchored by this wallet (client == caller) —
    // funding anyone else's job reverts Unauthorized on-chain.
    const bound = token ? tokenSubject(token) : null;
    if (!bound || bound.toLowerCase() !== address.toLowerCase()) {
      setError(
        bound
          ? `This quote belongs to ${bound.slice(0, 6)}…${bound.slice(-4)} — switch back to that wallet to fund. The escrow rejects fund calls from any other wallet.`
          : 'Sign in first — the quote must be funded from the wallet that requested it.',
      );
      return;
    }
    setError(null);
    const signTriple = async () => {
      const nonce = `app-${Date.now()}`;
      const sig = await client.signMessage({ message: bindMessage(address, nonce), account: address });
      return { nonce, sig };
    };
    try {
      let jid = jobId;
      let params: JobParams | null = pending.jobParams ?? null;
      if (!jid && !params) {
        // 1. Bind: prove wallet ownership (EIP-191, gasless).
        setPhase('binding');
        const { nonce, sig } = await signTriple();
        // 2. Accept: server returns buyer-side escrow params (no chain writes).
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
          if (!escrow?.commerce || !escrow?.description) throw new Error('accept did not return escrow params');
          params = escrow as JobParams;
          dlog(`params ok provider=${params.provider.slice(0, 10)}… budget=${params.totalWei}`);
        } catch (acceptErr) {
          // Accept may outlive the 29s gateway clock — recover instead of dying.
          if (token) {
            const again = await getPendingRent(token).catch(() => null);
            if (again?.jobId && again.taskId === pending.taskId) {
              jid = again.jobId;
              dlog(`recovered reported job ${jid}`);
            } else if (again?.jobParams && again.taskId === pending.taskId) {
              params = again.jobParams;
              dlog('recovered unanchored params');
            } else if (pending.renewal) {
              const crews = await getLiveTeam(token).catch(() => []);
              const rj = crews.find((c) => c.taskId === pending.taskId)?.renewalJobId;
              if (rj) {
                jid = rj;
                dlog(`recovered renewal job ${jid}`);
              }
            }
          }
          if (!jid && !params) throw acceptErr;
        }
        setPhase('done-accepted');
      }
      const amount = BigInt(pending.totalWei);
      if (!jid) {
        // 3. Anchor: buyer creates the job as client, binds policy, sets budget.
        if (!params) throw new Error('missing escrow params — re-accept the quote');
        setPhase('creating');
        dlog('createJob as buyer...');
        jid = await createEscrowJob(client, address, params);
        dlog(`job ${jid} created (client = buyer)`);
        setJobId(jid);
        setPhase('registering');
        dlog('registerJob + setBudget...');
        await registerAndBudget(client, address, params, BigInt(jid));
        dlog('register + budget ok');
        // 4. Report the anchored job BEFORE funding — a slow fund
        // confirmation must never strand a FUNDED job unknown to the backend.
        setPhase('reporting');
        dlog(`report job ${jid}...`);
        {
          const { nonce, sig } = await signTriple();
          const rep = await a2aSend({
            skill: 'crew-report-job',
            task_id: pending.taskId,
            job_id: jid,
            buyerAddress: address,
            nonce,
            buyerSig: sig,
          }).catch((e) => ({ text: `report failed: ${e instanceof Error ? e.message : String(e)}` }));
          dlog(`report: ${(rep as any).text?.slice(0, 120) ?? JSON.stringify(rep).slice(0, 120)}`);
          if (!/recorded/i.test((rep as any).text ?? '')) {
            throw new Error(`job report rejected: ${(rep as any).text ?? 'unknown'}`);
          }
        }
      }
      // 5. Approve U (only what the escrow needs).
      setPhase('approving');
      dlog(`approve ${pending.totalWei} wei U -> escrow`);
      try {
        await approveU(client, address, amount);
        dlog('approve ok');
      } catch (e) {
        dlog(`approve REVERT: ${e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160)}`);
        throw e;
      }
      // 4. Dry-run fund via eth_call first — decoded revert, no gas spent.
      dlog(`simulate fund(job=${jid} amount=${pending.totalWei})`);
      try {
        const sim = await simulateFund(address, BigInt(jid!), amount);
        dlog(sim.ok ? 'simulate ok' : `simulate REVERT: ${sim.revert}${sim.raw ? ` data=${sim.raw.slice(0, 66)}` : ''}`);
      } catch (e) {
        dlog(`simulate error: ${e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)}`);
      }
      // 6. Fund on-chain (buyer is the job client, so this succeeds).
      setPhase('funding');
      const hash = await fundJob(client, address, BigInt(jid!), amount);
      setTx(hash);
      getUBalance(address).then(setBalance).catch(() => {});
      // 7. Renewals credit onto the live clock (already WORKING); fresh hires
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
    accepting: 'Getting escrow params…',
    creating: 'Creating the escrow job as buyer…',
    registering: 'Binding policy + budget…',
    reporting: 'Recording the job…',
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
      <details className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-wfink">Debug log ({debug.length})</summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-wfnavy">
          {debug.length ? debug.join('\n') : '(no events yet)'}
        </pre>
        {debug.length > 0 && (
          <button
            onClick={() => void navigator.clipboard?.writeText(debug.join('\n')).catch(() => {})}
            className="mt-1 text-xs font-semibold text-wfcta underline hover:no-underline"
          >
            Copy log
          </button>
        )}
      </details>
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
