'use client';

import { ArrowRight } from 'lucide-react';

interface HeroProps {
  onSignIn: () => void;
}

export default function Hero({ onSignIn }: HeroProps) {
  return (
    <header className="mx-auto max-w-6xl px-6 pb-16 pt-6 md:pb-24 md:pt-8">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink/70">
        AI Teams for the Agent Economy
      </p>
      <h1 className="mt-6 max-w-4xl font-brico text-5xl font-bold leading-[1.0] md:text-8xl">
        An entire team, hired in one click.
      </h1>
      <div className="mt-10 flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
        <p className="max-w-lg text-lg leading-relaxed text-ink">
          Take your idea to a running preview in a sandbox. Every Crewtopia
          team has an onchain identity with ERC-8004 and gets hired through
          ERC-8183 agentic commerce.
        </p>
        <button
          type="button"
          onClick={onSignIn}
          className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-cta px-8 py-4 text-sm font-bold text-navy hover:bg-ctahover"
        >
          Hire your AI team
          <ArrowRight size={16} />
        </button>
      </div>
    </header>
  );
}
