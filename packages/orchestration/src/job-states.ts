export const JOB_STATES = [
  "queued",
  "running",
  "succeeded",
  "waiting_approval",
  "retry_wait",
  "failed",
  "unknown",
  "cancelled",
] as const;

export type JobState = (typeof JOB_STATES)[number];

const ALLOWED: Record<JobState, readonly JobState[]> = {
  queued: ["running", "cancelled"],
  running: [
    "succeeded",
    "waiting_approval",
    "retry_wait",
    "failed",
    "unknown",
    "cancelled",
  ],
  waiting_approval: ["queued", "cancelled"],
  retry_wait: ["queued", "cancelled"],
  succeeded: [],
  failed: [],
  unknown: [],
  cancelled: [],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid job transition ${from} -> ${to}`);
  }
}
