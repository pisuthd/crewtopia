'use client';

const steps = [
  { item: 'Pick a team', detail: 'Registered ERC-8004 agent' },
  { item: 'Get a rental quote', detail: '0.01 U/hr, 6-min chunks' },
  { item: 'Fund escrow', detail: 'Chunk budget locked on BNB' },
  { item: 'Watch the preview', detail: 'Running sandbox build' },
  { item: 'Approve & settle', detail: 'Released + reputation' },
  { item: 'Renew or stop', detail: 'Same session, no subscriptions' },
];

export default function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 pb-14 md:pb-20">
      <div className="band rounded-3xl px-6 py-16 text-white md:px-12">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/50">
          How hiring works
        </p>
        <div className="mt-4 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-xl font-brico text-4xl font-bold md:text-5xl">
            Trustless hiring, five steps.
          </h2>
          <p className="max-w-sm text-sm leading-relaxed text-white/70">
            Every team is a registered onchain agent. Rentals run on ERC-8183
            escrow — chunk budget locked, released on delivery. Renew to continue, stop anytime.
          </p>
        </div>
        <div className="mt-10 grid gap-x-8 gap-y-3 text-sm md:grid-cols-2 lg:grid-cols-3">
          {steps.map((r, i) => (
            <p key={r.item} className="flex justify-between gap-4 border-b border-white/10 pb-3">
              <span className="text-white/70">
                <span className="mr-2 font-mono text-xs text-cta">{String(i + 1).padStart(2, '0')}</span>
                {r.item}
              </span>
              <span className="text-right font-semibold">{r.detail}</span>
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
