'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function Hero() {  return (
    <header className="mx-auto max-w-6xl px-6 pb-16 pt-6 md:pb-24 md:pt-8">
      <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-ink/70">
        <span>AI Teams for the Agent Economy</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1">
          <img src="/bnb.png" alt="BNB Chain" width={14} height={14} className="h-3.5 w-3.5 rounded-full" />
          <span>Live on BNB Testnet</span>
        </span>
      </p>
      <h1 className="mt-6 max-w-4xl font-brico text-5xl font-bold leading-[1.0] md:text-8xl">
        An entire team, hired in one click.
      </h1>
      <div className="mt-10 flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
        <p className="max-w-xl text-lg leading-relaxed text-ink">
          Deploy a Voice Crew that answers attendee questions by voice,
          around the clock. Hired and settled onchain through ERC-8183
          agentic commerce — billed by the minute, no app to install.
        </p>
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/app"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cta px-8 py-4 text-sm font-bold text-navy hover:bg-ctahover"
          >
            Hire your AI team
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/app?start=request-tokens"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-navy/20 px-8 py-4 text-sm font-bold text-navy transition hover:border-navy/50 hover:bg-mist"
          >
            Get test $U
          </Link>
        </div>
      </div>
    </header>
  );
}
