import type { DatabaseClient } from "./db.js";
import type { JobState } from "./job-states.js";

export type JobRow = {
  id: string;
  command_id: string;
  workflow_id: string;
  workflow_version: string;
  state: JobState;
  current_step: string | null;
  trace_id: string;
  created_at: Date;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
};

export type JobResponse = {
  id: string;
  commandId: string;
  workflow: { id: string; version: string };
  state: JobState;
  currentStep: string | null;
  traceId: string;
  createdAt: string;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
};

export function toJobResponse(row: JobRow): JobResponse {
  return {
    id: row.id,
    commandId: row.command_id,
    workflow: {
      id: row.workflow_id,
      version: row.workflow_version,
    },
    state: row.state,
    currentStep: row.current_step,
    traceId: row.trace_id,
    createdAt: row.created_at.toISOString(),
    result: row.result,
    error: row.error,
  };
}

export async function getJobRow(
  client: DatabaseClient,
  jobId: string,
): Promise<JobRow | undefined> {
  const result = await client.query<JobRow>(
    `SELECT id, command_id, workflow_id, workflow_version, state, current_step,
            trace_id, created_at, result, error
       FROM control.jobs
      WHERE id = $1`,
    [jobId],
  );
  return result.rows[0];
}
