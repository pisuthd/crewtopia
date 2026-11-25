'use client';

import type { HexbotColor, HexbotRole } from '../Hexbot';

/** Selectable sidebar row — crew members use live ids. */
export interface SidebarBot {
  id: string;
  name: string;
  role: string;
  description: string;
  color: HexbotColor;
  hexRole: HexbotRole;
}

/** Display meta for live crew members — mirrors backend lambda/teams.ts ROSTER. */
export const CREW_META: Record<string, { name: string; title: string; color: HexbotColor; hexRole: HexbotRole; description: string }> = {
  pm: { name: 'Taylor', title: 'Tech Lead', color: 'honey', hexRole: 'pm', description: 'Triage, splits work, owns build.' },
  frontend: { name: 'Reef', title: 'Frontend Developer', color: 'blue', hexRole: 'frontend', description: 'Builds the dapp and its preview.' },
  backend: { name: 'Moss', title: 'Backend Developer', color: 'grape', hexRole: 'backend', description: 'APIs, DB/auth, on-chain wiring.' },
};

const CUSTOM_COLORS: HexbotColor[] = ['lagoon', 'coral', 'carbon', 'blue', 'grape', 'honey'];
const KNOWN_HEX: Record<string, HexbotRole> = {
  pm: 'pm',
  ux: 'ux',
  frontend: 'frontend',
  backend: 'backend',
  director: 'director',
  stylist: 'stylist',
  generator: 'generator',
  retoucher: 'retoucher',
};

export interface MemberMeta {
  name: string;
  title: string;
  color: HexbotColor;
  hexRole: HexbotRole;
  description: string;
}

/** Meta for any rental member: static crew from CREW_META, custom bots derived. */
export function memberMetaFor(role: string, name: string, title: string, index = 0): MemberMeta {
  const known = CREW_META[role];
  if (known) return known;
  return {
    name,
    title,
    color: CUSTOM_COLORS[index % CUSTOM_COLORS.length],
    hexRole: KNOWN_HEX[role] ?? 'ux',
    description: title,
  };
}
