'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Hexbot, { type HexbotColor, type HexbotRole } from '../Hexbot';
import { getFeedbackTally } from '@/lib/feedback';

interface TeamCard {
  members: { color: HexbotColor; role: HexbotRole }[];
  name: string;
  tagline: string;
  rate: string;
  roles: string;
  pipeline: string[];
  slug: string;
  agentId: number | null;
  explorerUrl: string | null;
  live: boolean;
}

// Voice + Dev live (rentable); Image + Video landing only until their
// agents go live — pipeline shows each crew's workflow to deliverable.
const cards: TeamCard[] = [
  {
    members: [
      { color: 'coral', role: 'pm' },
      { color: 'honey', role: 'ux' },
      { color: 'lagoon', role: 'backend' },
    ],
    name: 'Voice Crew',
    tagline: 'Handle real-time voice for agents and businesses.',
    rate: '0.01 U/hr',
    roles: 'Concierge, Scout, Keeper',
    pipeline: ['Conversation', 'Research', 'Action', 'Resolution'],
    slug: 'voice-crew',
    agentId: 2920,
    explorerUrl: 'https://testnet.8004scan.io/agents/bsc-testnet/2920',
    live: true,
  },
  {
    members: [
      { color: 'honey', role: 'pm' },
      { color: 'blue', role: 'frontend' },
      { color: 'grape', role: 'backend' },
    ],
    name: 'Dev Crew',
    tagline: 'Build a working landing page or application.',
    rate: '0.01 U/hr',
    roles: 'Tech Lead, Frontend, Backend',
    pipeline: ['Idea', 'Code', 'Test', 'Running preview'],
    slug: 'dev-crew',
    agentId: 2919,
    explorerUrl: 'https://testnet.8004scan.io/agents/bsc-testnet/2919',
    live: true,
  },
  {
    members: [
      { color: 'honey', role: 'director' },
      { color: 'blue', role: 'generator' },
      { color: 'coral', role: 'retoucher' },
    ],
    name: 'Image Crew',
    tagline: 'Create a complete branded social campaign.',
    rate: '0.01 U/hr',
    roles: 'Director, Generator, Retoucher',
    pipeline: ['Brief', 'Concepts', 'Design', 'Asset package'],
    slug: 'image-crew',
    agentId: null,
    explorerUrl: null,
    live: false,
  },
  {
    members: [
      { color: 'lagoon', role: 'director' },
      { color: 'grape', role: 'stylist' },
      { color: 'blue', role: 'ux' },
    ],
    name: 'Video Crew',
    tagline: 'Produce a 30-second product advertisement.',
    rate: '0.01 U/hr',
    roles: 'Director, Script, Editor',
    pipeline: ['Brief', 'Script', 'Scenes', 'Edited video'],
    slug: 'video-crew',
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
          Get a complete AI team with roles, workspace, and tools ready to go. Rent by the minute and review real progress with live preview.
        </p>
      </div>

      <div className="fade-up mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2">
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
  const [tally, setTally] = useState<{ count: number; avg: number } | null>(null);
  useEffect(() => {
    if (!card.live) return;
    let alive = true;
    getFeedbackTally(card.slug).then((t) => {
      if (alive && t && t.count > 0) setTally({ count: t.count, avg: t.avg });
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [card.slug, card.live]);
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
      {tally && (
        <p className="mt-1.5 text-xs font-semibold text-navy" title="Buyer ratings recorded onchain">
          ★ {tally.avg.toFixed(1)} · {tally.count} onchain rating{tally.count === 1 ? '' : 's'}
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-ink/70">{card.roles}</p>
      {!tally && (
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {card.pipeline.map((step, i) => (
          <span key={step} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true" className="text-[10px] text-ink/40">→</span>}
            <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${i === card.pipeline.length - 1 ? 'bg-navy text-white' : 'bg-gray-100 text-ink/70'}`}>
              {step}
            </span>
          </span>
        ))}
      </div>
      )}
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
