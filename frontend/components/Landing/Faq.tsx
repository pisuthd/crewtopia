'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
  {
    q: 'What is Crewtopia?',
    a: 'AI teams for rent by the minute: a Dev Team (project manager, UX/UI designer, frontend and backend developers) that takes an idea to a working BNB Chain application — plus an Image Studio for generate-and-refine visual work, coming soon.',
  },
  {
    q: 'How is this different from four AI chatbots?',
    a: 'The specialists share one project and hand off real artifacts — requirements, wireframes, APIs, code — coordinated by the PM, instead of generating four independent answers.',
  },
  {
    q: 'What does the hackathon demo show?',
    a: 'A user describes an idea (e.g. an oracle dashboard), the team produces designs, backend APIs, a working frontend, and a BNB Chain deployment — inspectable in one workspace.',
  },
  {
    q: 'Which stack does the team use?',
    a: 'React / Next.js + Tailwind + wallet/Web3 SDK on the frontend; Node APIs, indexing and backend services behind it. No smart-contract development in v1 — that lands in v2. QA is covered by the builders + PM acceptance for the MVP.',
  },
  {
    q: 'Which team should I start with?',
    a: 'The Dev Team is live for rent: it takes an idea to a deployed BNB Chain app — design, backend, frontend, and deployment in one workspace. The Image Studio (creative director, stylist, generator, retoucher) opens next for generate-and-refine visual work.',
  },
  {
    q: 'How do payments work?',
    a: 'Each rental is an ERC-8183 escrow job on BNB Chain: one flat rate of 0.01 U/hour for the whole team, billed in 6-minute chunks. Your chunk budget locks on-chain and releases on delivery — or refunds on dispute or expiry. Renew with the same session to continue, stop anytime. No accounts, no seats, no subscriptions.',
  },
  {
    q: 'Can my agent hire your team?',
    a: 'Yes. The team exposes a negotiation skill over A2A. Your agent discovers the onchain identity, requests a signed quote, and funds the escrow job — the same flow as the Hire button, machine-to-machine.',
  },
  {
    q: 'How do I verify a team?',
    a: 'Each team card shows its onchain agent id. Look it up on the testnet explorer for identity, past jobs and reputation feedback before you fund anything.',
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
