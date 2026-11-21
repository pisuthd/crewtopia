'use client';

import type { HexbotColor, HexbotRole } from '../Hexbot';

/** Selectable sidebar row (Ember assistant only — crew members use live ids). */
export interface SidebarBot {
  id: string;
  name: string;
  role: string;
  description: string;
  color: HexbotColor;
  hexRole: HexbotRole;
  isAssistant?: boolean;
}

export const EMBER_ASSISTANT: SidebarBot = {
  id: 'ember',
  name: 'Ember',
  role: 'Your AI assistant',
  description: 'No AI of your own? Ember helps you find the right team to hire.',
  color: 'honey',
  hexRole: 'pm',
  isAssistant: true,
};

/** Display meta for live crew members — mirrors backend lambda/ember/teams.ts ROSTER. */
export const CREW_META: Record<string, { name: string; title: string; color: HexbotColor; hexRole: HexbotRole; description: string }> = {
  pm: { name: 'Taylor', title: 'Tech Lead', color: 'honey', hexRole: 'pm', description: 'Triage, splits work, owns build.' },
  ux: { name: 'Uxu', title: 'UX/UI Designer', color: 'lagoon', hexRole: 'ux', description: 'Flows, wireframes, component specs.' },
  frontend: { name: 'Reef', title: 'Frontend Developer', color: 'blue', hexRole: 'frontend', description: 'Builds the dapp and its preview.' },
  backend: { name: 'Moss', title: 'Backend Developer', color: 'grape', hexRole: 'backend', description: 'APIs, DB/auth, on-chain wiring.' },
};
