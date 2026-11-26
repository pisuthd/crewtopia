'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') ?? '';

interface Hire {
  taskId: string;
  team: string;
  teamId: string;
  buyer: string;
  minutes: number;
  totalU: string;
  status: string;
  jobId: string;
  createdAt: string;
}

function short(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const STATUS_STYLE: Record<string, string> = {
  working: 'bg-emerald-100 text-emerald-800',
  funding: 'bg-amber-100 text-amber-800',
  ended: 'bg-gray-100 text-ink/60',
};

export default function Explorer() {
  const [hires, setHires] = useState<Hire[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API}/rent/io/hires`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!alive) return;
        setHires(Array.isArray(b?.hires) ? b.hires : []);
        setTotal(typeof b?.total === 'number' ? b.total : null);
      })
      .catch(() => {
        if (alive) {
          setHires([]);
          setTotal(null);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const totalU = (hires ?? []).reduce((sum, h) => sum + (Number(h.totalU) || 0), 0);

  return (
    <section id="explorer" className="mx-auto max-w-6xl px-6 pb-14 pt-4 md:pb-20 md:pt-6">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink/70">
          Onchain proof
        </p>
        <h2 className="mt-4 font-brico text-4xl font-bold md:text-5xl">Live hires</h2>
        <p className="mt-4 leading-relaxed text-ink">
          Every rental lives onchain with its buyer, team and budget open for anyone to verify.
        </p>
        {hires !== null && hires.length > 0 && (
          <div className="mt-6 flex items-center justify-center gap-2.5">
            <span className="rounded-full bg-mist px-4 py-1.5 font-mono text-xs font-bold text-navy">
              {(total ?? hires.length)} hire{(total ?? hires.length) === 1 ? '' : 's'}
            </span>
            <span className="rounded-full bg-mist px-4 py-1.5 font-mono text-xs font-bold text-navy">
              {totalU.toFixed(3)} $U transacted
            </span>
          </div>
        )}
      </div>
      <div className="mt-10 overflow-x-auto rounded-2xl border border-gray-200">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-mist font-mono text-[11px] uppercase tracking-widest text-ink/60">
              <th className="px-4 py-3 font-semibold">Team</th>
              <th className="px-4 py-3 font-semibold">Buyer</th>
              <th className="px-4 py-3 font-semibold">Time</th>
              <th className="px-4 py-3 font-semibold">Budget</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Job</th>
            </tr>
          </thead>
          <tbody>
            {hires === null && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/60">
                  Loading onchain hires…
                </td>
              </tr>
            )}
            {hires !== null &&
              hires.map((h) => (
                <tr key={`${h.jobId}-${h.taskId}`} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-bold text-navy">{h.team}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink" title={h.buyer}>
                    {short(h.buyer)}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink/70" title={h.createdAt}>
                    {h.minutes}m · {ago(h.createdAt)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-navy">{h.totalU} U</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${STATUS_STYLE[h.status] ?? 'bg-gray-100 text-ink/60'}`}>
                      {h.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`https://testnet.bscscan.com/address/0xa206c0517b6371C6638CD9e4a42Cc9f02A33B0DE`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs font-semibold text-cta underline hover:no-underline"
                      title={`Escrow job ${h.jobId}`}
                    >
                      #{h.jobId} ↗
                    </a>
                  </td>
                </tr>
              ))}
            {hires !== null && hires.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/60">
                  No hires yet — be the first to put a team to work.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
