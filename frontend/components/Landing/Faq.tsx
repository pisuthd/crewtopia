'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
  {
    q: 'What is Crewtopia?',
    a: 'AI teams for hire that finish the job: a Voice Crew that handles real-time customer conversations, a Dev Crew that builds working applications, plus Image and Video Crews for branded campaigns and product ads — each running its own workflow from brief to deliverable.',
  },
  {
    q: 'How is this different from AI chatbots or generators?',
    a: 'You buy a finished deliverable, not a chat reply or a single file. The specialists share one job and hand off real work — a resolved inquiry, a running preview, an asset package, an edited video — coordinated as one team instead of generating independent answers.',
  },
  {
    q: 'How does the Voice Crew work?',
    a: 'Each Voice Crew has one agent marked for voice with speaking enabled. Open its talk page to test the mic: speak and hear it answer in realtime. When it sounds right, generate a guest link and share it anywhere — customers talk by voice, no app to install. Voice is powered by the ElevenLabs Speech Engine running inside the crew\u2019s own sandbox, metered by the minute through onchain escrow.',
  },
  {
    q: 'Which team should I start with?',
    a: 'Voice and Dev are live for hire: Voice handles real-time customer conversations, Dev builds working landing pages and applications. Image (branded social campaigns) and Video (30-second product ads) open next.',
  },
  {
    q: 'How do payments work?',
    a: 'Each hire is an ERC-8183 escrow job on BNB Chain: one flat rate of 0.01 U/hour for the whole team. Your budget locks on-chain and releases on delivery — or refunds on dispute or expiry. Renew to continue, stop anytime. No accounts, no seats, no subscriptions.',
  },
  {
    q: 'Can my agent hire your team?',
    a: 'Yes. Each crew exposes a negotiation skill over A2A. Your agent discovers the onchain identity, requests a signed quote, and funds the escrow job — the same flow as the Hire button, machine-to-machine.',
  },
  {
    q: 'How do I verify a team?',
    a: 'Each team card shows its onchain agent id. Look it up on 8004scan for identity, past jobs and reputation feedback before you fund anything.',
  },
];

export default function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-14 md:py-20">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.25em] text-ink/70">FAQ</p>
      <h2 className="mt-4 text-center font-brico text-4xl font-bold md:text-5xl">
        Questions, answered.
      </h2>
      <div className="mt-10 divide-y divide-gray-200 border-y border-gray-200">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? -1 : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 py-5 text-left"
              >
                <span className="font-brico text-lg font-bold">{f.q}</span>
                <ChevronDown
                  size={20}
                  className={`shrink-0 text-ink transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>
              <div
                className={`grid transition-all duration-300 ease-in-out ${
                  isOpen ? 'grid-rows-[1fr] pb-5 opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <p className="overflow-hidden leading-relaxed text-ink">{f.a}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
