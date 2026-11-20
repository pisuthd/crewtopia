'use client';

export default function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-3xl px-6 py-14 md:py-20">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.25em] text-ink/70">
        How it works
      </p>
      <h2 className="mt-4 text-center font-brico text-4xl font-bold md:text-5xl">
        It feels like texting your team.
      </h2>
      <div className="mx-auto mt-12 max-w-xl space-y-4">
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-navy px-5 py-3.5 text-sm text-white">
          Build an oracle price dashboard on BNB Chain.
        </div>
        <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-mist px-5 py-3.5 text-sm">
          <span className="font-bold">PM</span>{' '}
          <span className="text-ink">
            · On it. <span className="font-semibold text-navy">@backend</span> price-feed APIs + indexing,{' '}
            <span className="font-semibold text-navy">@frontend</span> trading UI.
          </span>
        </div>
        <div className="ml-8 w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-mist px-5 py-3.5 text-sm">
          <span className="font-bold">Backend</span>{' '}
          <span className="text-ink">
            · <span className="font-semibold text-navy">@pm</span> APIs live, feeds indexed, tested.
          </span>
        </div>
        <div className="ml-8 w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-mist px-5 py-3.5 text-sm">
          <span className="font-bold">Frontend</span>{' '}
          <span className="text-ink">
            · <span className="font-semibold text-navy">@pm</span> wallet + dashboard wired to the APIs.
          </span>
        </div>
        <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-mist px-5 py-3.5 text-sm">
          <span className="font-bold">PM</span>{' '}
          <span className="text-ink">· APIs live, UI wired, tests green. Approve to ship?</span>
        </div>
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-cta px-5 py-3.5 text-sm font-semibold text-navy">
          Approved. Ship it.
        </div>
      </div>
    </section>
  );
}
