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
    name: 'Crewtopia Dev Crew',
    tagline: 'Rent the whole bench by the minute.',
    rate: '0.01 U/hr · 6-min chunks',
    roles: 'Project Manager · UX/UI Designer · Frontend Developer · Backend Developer',
    slug: 'dev-crew',
    agentId: 2885,
    explorerUrl: 'https://8004scan.io/agents?search=wayfind-dev-team',
    live: true,
  },
  {
    members: [
      { color: 'honey', role: 'director' },
      { color: 'coral', role: 'stylist' },
      { color: 'blue', role: 'generator' },
      { color: 'carbon', role: 'retoucher' },
    ],
    name: 'Crewtopia Studio Crew',
    tagline: 'Generate, edit, and refine — coming soon.',
    rate: '0.01 U/hr · 6-min chunks',
    roles: 'Creative Director · Stylist · Image Generator · Retoucher',
    slug: 'studio-crew',
    agentId: null,
    explorerUrl: null,
    live: false,
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
          Prebuilt AI teams with specialized roles, a shared workspace, and the tools to get things done. Rent them by the minute — describe your goal, and let them work together.
        </p>
      </div>

      <div className="fade-up mt-12 grid max-w-4xl gap-6 md:grid-cols-2">
        {cards.map((card) => (
          <div key={card.slug}>
            {card.live ? (
              <Link
                href={`/app?hire=${card.slug}`}
                className="group flex h-full flex-col rounded-2xl border border-gray-200 p-7 transition hover:-translate-y-1 hover:border-navy/40 hover:shadow-lg"
              >
                <CardBody card={card} />
              </Link>
            ) : (
              <div className="flex h-full flex-col rounded-2xl border border-dashed border-gray-300 p-7 opacity-90">
                <CardBody card={card} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function CardBody({ card }: { card: TeamCard }) {
  return (
    <>
      <div className="flex -space-x-1.5">
        {card.members.map((m, i) => (
          <span key={m.role} className="rounded-full ring-2 ring-white">
            <Hexbot color={m.color} role={m.role} size="xs" blinkDelay={`${i * 0.6}s`} label={`${m.role} hexbot`} />
          </span>
        ))}
      </div>
      <p className="mt-5 font-brico text-xl font-bold">
        {card.name}{' '}
        {card.live ? (
          <span aria-hidden="true" className="ml-1 inline-block transition group-hover:translate-x-1">→</span>
        ) : (
          <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 align-middle font-mono text-[10px] font-normal uppercase tracking-wide text-ink/60">
            soon
          </span>
        )}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink">{card.tagline}</p>
      <p className="mt-2 font-mono text-xs font-bold text-navy">{card.rate}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink/70">{card.roles}</p>
      <p className="mt-3 font-mono text-[11px] leading-relaxed">
        {card.agentId === null || !card.explorerUrl ? (
          <span className="text-ink/50">ERC-8004 · testnet id pending</span>
        ) : (
          <a
            href={card.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-navy underline decoration-[#F0B90B] decoration-2 underline-offset-2"
          >
            ERC-8004 agent #{card.agentId} · verify on explorer →
          </a>
        )}
      </p>
    </>
  );
}
