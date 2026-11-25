import type { Quote } from '../pricelist';

export type TaskMessage = { role: 'user' | 'agent'; text: string };

export type StoredTask = {
  taskId: string;
  contextId: string;
  skill: string;
  /** Wire team id (pricelist registry key, e.g. 'dev-crew'). Absent = dev-crew. */
  teamId?: string;
  /** Crew snapshot at quote time — mid-rental registry edits can't shift the hired crew. */
  roster?: Array<{ role: string; name: string; title: string; brief: string }>;
  brief: string;
  buyer: string | null;
  status: string;
  quote: Quote | null;
  /** How the quoted minutes were set. Accept requires 'explicit' on app tasks. */
  minutesSource?: 'explicit' | 'parsed' | 'default';
  /** True when the task was created through the app's rent_quote flow. */
  viaEmber?: boolean;
  jobId: string | null;
  /** Top-up awaiting accept/fund: extends fundedSeconds on the same task. */
  pendingRenewal?: {
    fundedSeconds: number;
    chunks: number;
    totalU: string;
    totalWei: string;
    createdAt: string;
  } | null;
  /** Renewal escrow job funded but not yet credited to the clock. */
  renewalJobId?: string | null;
  /** All renewal jobs (settle releases each; refunds are per-job). */
  renewalJobs?: Array<{
    jobId: string;
    fundedSeconds: number;
    totalU: string;
    totalWei: string;
    createdAt: string;
  }>;
  deliverable: { hash: string; url: string; submittedAt: string; health?: string; downloadUrl?: string } | null;
  approvedAt: string | null;
  /** When the task was flipped to working (rental clock starts here). */
  workingSince?: string | null;
  /** Crew run tracking for lazy supervision: latest run per role + nudge count. */
  crewRuns?: Record<string, { runId: string; startedAt: string; nudges: number; cursor?: number; done?: boolean }>;
  /** Speech Engine id for voice rentals (one engine per task, ws_url = sandbox /voice-chat). */
  voiceEngineId?: string | null;
  /** When the engine's proxy-auth request headers were last refreshed. */
  voiceEngineHeadersAt?: string | null;
  /** Guest share link id (unguessable) — hotel customers talk with no wallet. Null = no link. */
  guestLinkId?: string | null;
  /** Renter voice setup inherited by guests: greeting text + ticked speaker roles. */
  voiceConfig?: { greeting?: string; speakers?: string[] } | null;  /** Last lazy-supervision check (ms epoch) — checks self-throttle to ~60s. */
  lastCrewCheck?: number;
  /** When the rental was ended early (panel terminate). */
  endedAt?: string | null;
  messages: TaskMessage[];
  vm: { vmId: string; endpoint: string; bootedAt: string; smokeRunId?: string; terminatedAt?: string; suspendedAt?: string } | null;
  createdAt: string;
};
