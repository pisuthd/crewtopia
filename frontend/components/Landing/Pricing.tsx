'use client';

import Link from 'next/link';

export default function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 pb-14 md:pb-20">
      <div className="band rounded-3xl px-6 py-16 text-center text-white md:px-12">
        <h2 className="mx-auto max-w-2xl font-brico text-4xl font-bold md:text-5xl">
          Put an AI team to work.
        </h2>
        <p className="mx-auto mt-4 max-w-xl leading-relaxed text-white/70">
          Describe your goal, fund the build, review the live preview.
        </p>
        <div className="mt-8">
          <Link
            href="/app"
            className="inline-flex items-center justify-center rounded-2xl bg-cta px-8 py-4 text-sm font-bold text-navy hover:bg-ctahover"
          >
            Launch app
          </Link>
        </div>
      </div>
    </section>
  );
}
