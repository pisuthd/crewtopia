import type { Quote } from '../pricelist';

export type TaskMessage = { role: 'user' | 'agent'; text: string };

export type StoredTask = {
  taskId: string;
  contextId: string;
  skill: string;
  brief: string;
  buyer: string | null;
  status: string;
  quote: Quote | null;
  /** How the quoted minutes were set. Accept requires 'explicit' on Ember tasks. */
  minutesSource?: 'explicit' | 'parsed' | 'default';
  /** True when the task was created through Ember's rent_quote tool. */
  viaEmber?: boolean;
  jobId: string | null;
  deliverable: { hash: string; url: string; submittedAt: string; health?: string } | null;
  approvedAt: string | null;
  /** When the task was flipped to working (rental clock starts here). */
  workingSince?: string | null;
  /** When the rental was ended early (panel terminate). */
  endedAt?: string | null;
  messages: TaskMessage[];
  vm: { vmId: string; endpoint: string; bootedAt: string; smokeRunId?: string; terminatedAt?: string; suspendedAt?: string } | null;
  createdAt: string;
};
