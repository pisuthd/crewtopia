'use client';

import type { HexbotColor, HexbotRole } from '../Hexbot';

export interface MockBot {
  id: string;
  name: string;
  role: string;
  description: string;
  color: HexbotColor;
  hexRole: HexbotRole;
  isAssistant?: boolean;
}

export interface MockTeam {
  name: string;
  members: MockBot[];
}

export const ASSISTANT: MockBot = {
  id: 'ember',
  name: 'Ember',
  role: 'Your hiring assistant',
  description: 'No AI of your own? Ember helps you find the right team to hire.',
  color: 'honey',
  hexRole: 'pm',
  isAssistant: true,
};

export const CURRENT_TEAM: MockTeam = {
  name: 'Dev Crew',
  members: [
    {
      id: 'dev-pm',
      name: 'Pippa',
      role: 'Project Manager',
      description: 'Coordinates the Dev Crew and keeps your build on track.',
      color: 'lagoon',
      hexRole: 'pm',
    },
    {
      id: 'dev-ux',
      name: 'Uxu',
      role: 'UX/UI Designer',
      description: 'Designs clean interfaces for your dapp.',
      color: 'blue',
      hexRole: 'ux',
    },
    {
      id: 'dev-frontend',
      name: 'Fonti',
      role: 'Frontend Developer',
      description: 'Builds the app you see and click.',
      color: 'grape',
      hexRole: 'frontend',
    },
    {
      id: 'dev-backend',
      name: 'Bex',
      role: 'Backend Developer',
      description: 'Wires APIs, escrow, and onchain calls.',
      color: 'coral',
      hexRole: 'backend',
    },
  ],
};

/** Flat lookup for selection (assistant + all members). */
export const ALL_BOTS: MockBot[] = [ASSISTANT, ...CURRENT_TEAM.members];
