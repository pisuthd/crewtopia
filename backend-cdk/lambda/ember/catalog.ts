// Static assistant catalog (Phase 1: Ember only). Pricing decided later —
export const ASSISTANTS = [
  {
    id: 'ember',
    name: 'Ember',
    role: 'Your AI assistant',
    description: 'Your Muse-powered guide to hiring AI crews on Crewtopia.',
    price: 'Free during dry run',
    color: 'honey',
  },
] as const;

export type AssistantId = (typeof ASSISTANTS)[number]['id'];

export function isAssistantId(id: string): id is AssistantId {
  return (ASSISTANTS as readonly { id: string }[]).some((a) => a.id === id);
}
