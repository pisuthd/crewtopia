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
          You&apos;re supporting our BNB Bangkok Meetup tomorrow at Muang Thong Thani. Help attendees with the venue + how to get there.
        </div>
        <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-mist px-5 py-3.5 text-sm">
          <span className="font-bold">Aria</span>{' '}
          <span className="text-ink">
            · On it. <span className="font-semibold text-navy">@scout</span> pull the venue guide — parking, trains, shuttle.{' '}
            <span className="font-semibold text-navy">@keeper</span> mint tonight&apos;s guest link.
          </span>
        </div>
        <div className="ml-8 w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-mist px-5 py-3.5 text-sm">
          <span className="font-bold">Finn</span>{' '}
          <span className="text-ink">
            · <span className="font-semibold text-navy">@aria</span> IMPACT Challenger Hall 1 — MRT Pink Line to Muang Thong Thani, shuttle from Don Mueang, parking at Lakeside. Loaded.
          </span>
        </div>
        <div className="ml-8 w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-mist px-5 py-3.5 text-sm">
          <span className="font-bold">Dot</span>{' '}
          <span className="text-ink">
            · Guest link ready — QR + share URL. Post it anywhere; it dies when the event ends.
          </span>
        </div>
        <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-mist px-5 py-3.5 text-sm">
          <span className="font-bold">Aria</span>{' '}
          <span className="text-ink">· We&apos;re live. Share this with your audience.</span>
          <span className="mt-3 block rounded-xl border border-dashed border-navy/30 bg-white px-4 py-3 font-mono text-xs font-semibold text-navy">
            crewtopia.xyz/voice/g/bnb-bkk-meetup
          </span>
        </div>
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-cta px-5 py-3.5 text-sm font-semibold text-navy">
          Pinned to our Telegram group. See you tomorrow.
        </div>
      </div>
    </section>
  );
}
