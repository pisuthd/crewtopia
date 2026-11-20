'use client';

import Link from 'next/link';
import Hexbot, { type HexbotColor, type HexbotRole } from '../Hexbot';

interface TeamCard {
  members: { color: HexbotColor; role: HexbotRole }[];
  name: string;
  tagline: string;
  rate: string;
  roles: string;
  slug: string;
  agentId: number | null;
  explorerUrl: string | null;
  live: boolean;
}

// Dev Team (live, rentable) + Image Studio (landing only — no agent
// registered yet, card links nowhere until the studio goes live).
const cards: TeamCard[] = [
  {
    members: [
      { color: 'honey', role: 'pm' },
      { color: 'lagoon', role: 'ux' },
      { color: 'blue', role: 'frontend' },
      { color: 'grape', role: 'backend' },
    ],
    name: 'Dev Crew',
    tagline: 'A full dev team for your next build.',
    rate: '0.01 U/hr',
    roles: 'Project Manager, Frontend, Backend, QA',
    slug: 'dev-crew',
    agentId: 2885,
    explorerUrl: 'https://8004scan.io/agents?search=wayfind-dev-team',
    live: true,
  },
  {
    members: [
      { color: 'honey', role: 'director' },
      { color: 'blue', role: 'generator' },
      { color: 'coral', role: 'retoucher' },
    ],
    name: 'Studio Crew',
    tagline: 'From idea to illustrated story.',
    rate: '0.01 U/hr',
    roles: 'Creative Director, Illustrator, Retoucher',
    slug: 'studio-crew',
    agentId: null,
    explorerUrl: null,
    live: true,
  },
];

export default function Teams() {
  return (
    <section id="team" className="mx-auto max-w-6xl px-6 py-14 md:py-20">
      <div className="max-w-2xl">
        <h2 className="font-brico text-4xl font-bold md:text-5xl">
          Meet the teams
        </h2>
        <p className="mt-4 leading-relaxed text-ink">
          Get a complete AI team with roles, workspace, and tools ready to go. Rent by the minute and review real progress with live preview.
        </p>
      </div>

      <div className="fade-up mt-12 grid gap-6 md:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.slug}
            className={`flex h-full flex-col rounded-2xl border p-7 ${
              card.live ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-90'
            }`}
          >
            <CardBody card={card} />
          </div>
        ))}
      </div>
    </section>
  );
}

function CardBody({ card }: { card: TeamCard }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex -space-x-1.5">
          {card.members.map((m, i) => (
            <span key={m.role} className="rounded-full ring-2 ring-white">
              <Hexbot color={m.color} role={m.role} size="xs" blinkDelay={`${i * 0.6}s`} label={`${m.role} hexbot`} />
            </span>
          ))}
        </div>
        <p className="whitespace-nowrap font-mono text-xs font-bold text-navy">{card.rate}</p>
      </div>
      <p className="mt-5 font-brico text-xl font-bold">
        {card.name}{' '}
        {!card.live && (
          <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 align-middle font-mono text-[10px] font-normal uppercase tracking-wide text-ink/60">
            soon
          </span>
        )}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink">{card.tagline}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink/70">{card.roles}</p>
      <div className="mt-auto flex gap-2 pt-5">
        {card.live ? (
          <Link
            href={`/app?hire=${card.slug}`}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-cta px-4 py-2.5 text-sm font-bold text-navy transition hover:bg-ctahover"
          >
            Hire team <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <span className="inline-flex flex-1 cursor-not-allowed items-center justify-center rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-ink/50">
            Coming soon
          </span>
        )}
        {card.explorerUrl ? (
          <a
            href={card.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-navy transition hover:border-navy/40"
          >
            8004scan <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="inline-flex flex-1 items-center justify-center rounded-xl border border-dashed border-gray-200 px-4 py-2.5 font-mono text-[11px] text-ink/50">
            ID pending
          </span>
        )}
      </div>
    </>
  );
}
