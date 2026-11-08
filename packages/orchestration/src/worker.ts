import type { DatabaseClient, DatabasePool } from "./db.js";
import { setWorkspace, withTransaction } from "./db.js";
import { ApiError } from "./errors.js";
import { assertTransition, type JobState } from "./job-states.js";
import { sha256Hex } from "./hash.js";
import { runDailyBrief } from "./workflows/daily-brief.js";
import { runHealth } from "./workflows/health.js";

type ClaimedJob = {
  id: string;
  workspace_id: string;
  command_id: string;
  workflow_id: string;
  workflow_version: string;
  state: JobState;
  lease_token: string;
  attempts: number;
  max_attempts: number;
  payload: CommandPayload;
};

type CommandPayload = {
  action: "system.health" | "project.dailyBrief";
  input: { projectId?: string; delivery?: string };
};

const CLAIM_SQL = `
WITH candidate AS (
  SELECT j.id
  FROM control.jobs j
  JOIN control.workspaces w
    ON w.id = j.workspace_id
  WHERE j.workspace_id = $1
    AND NOT w.paused
    AND j.state IN ('queued', 'retry_wait')
    AND j.available_at <= now()
    AND j.attempts < j.max_attempts
  ORDER BY j.available_at, j.created_at
  FOR UPDATE OF j SKIP LOCKED
  LIMIT 1
)
UPDATE control.jobs j
SET
  state = 'running',
  lease_token = gen_random_uuid(),
  lease_expires_at = now() + interval '60 seconds',
  attempts = attempts + 1,
  updated_at = now()
FROM candidate c
WHERE j.id = c.id
RETURNING j.id, j.workspace_id, j.command_id, j.workflow_id, j.workflow_version,
          j.state, j.lease_token, j.attempts, j.max_attempts
`;

async function claimJob(
  pool: DatabasePool,
  workspaceId: string,
): Promise<ClaimedJob | null> {
  return withTransaction(pool, async (client) => {
    await setWorkspace(client, workspaceId);
    const claimed = await client.query<Omit<ClaimedJob, "payload">>(CLAIM_SQL, [
      workspaceId,
    ]);
    const job = claimed.rows[0];
    if (!job) {
      return null;
    }
    const command = await client.query<{ payload: CommandPayload }>(
      "SELECT payload FROM control.commands WHERE id = $1",
      [job.command_id],
    );
    const payload = command.rows[0]?.payload;
    if (!payload) {
      throw new Error("claimed job has no command payload");
    }
    return { ...job, payload };
  });
}

async function recordStep(
  client: DatabaseClient,
  workspaceId: string,
  jobId: string,
  stepId: string,
  state: "running" | "succeeded" | "failed",
  error?: Record<string, unknown>,
): Promise<string> {
  const step = await client.query<{ id: string }>(
    `INSERT INTO control.step_runs (
       workspace_id, job_id, step_id, state, started_at, ended_at, error
     ) VALUES ($1, $2, $3, $4, now(), CASE WHEN $4 = 'running' THEN NULL ELSE now() END, $5::jsonb)
     ON CONFLICT (job_id, step_id) DO UPDATE
       SET state = EXCLUDED.state,
           ended_at = EXCLUDED.ended_at,
           error = EXCLUDED.error
     RETURNING id`,
    [workspaceId, jobId, stepId, state, error ? JSON.stringify(error) : null],
  );
  const stepRunId = step.rows[0]?.id;
  if (!stepRunId) {
    throw new Error("step run insert returned no id");
  }
  if (state !== "running") {
    const attemptNumber = await client.query<{ n: string }>(
      `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS n
         FROM control.attempts WHERE step_run_id = $1`,
      [stepRunId],
    );
    await client.query(
      `INSERT INTO control.attempts (
         workspace_id, step_run_id, attempt_number, state, error
       ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        workspaceId,
        stepRunId,
        Number(attemptNumber.rows[0]?.n ?? 1),
        state,
        error ? JSON.stringify(error) : null,
      ],
    );
  }
  return stepRunId;
}

async function finishJob(
  pool: DatabasePool,
  job: ClaimedJob,
  next: { state: JobState; result?: Record<string, unknown>; error?: Record<string, unknown> },
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await setWorkspace(client, job.workspace_id);
    assertTransition("running", next.state);
    const updated = await client.query(
      `UPDATE control.jobs
          SET state = $1,
              result = $2::jsonb,
              error = $3::jsonb,
              current_step = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = now()
        WHERE id = $4
          AND lease_token = $5
          AND state = 'running'`,
      [
        next.state,
        next.result ? JSON.stringify(next.result) : null,
        next.error ? JSON.stringify(next.error) : null,
        job.id,
        job.lease_token,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new Error("lost job lease before completion");
    }
    await client.query(
      `INSERT INTO control.audit_events (workspace_id, job_id, type, details)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        job.workspace_id,
        job.id,
        `job.${next.state}`,
        JSON.stringify({ workflow: job.workflow_id }),
      ],
    );
  });
}

async function executeClaimed(
  pool: DatabasePool,
  job: ClaimedJob,
): Promise<Record<string, unknown>> {
  if (job.workflow_id === "system.health") {
    return withTransaction(pool, async (client) => {
      await setWorkspace(client, job.workspace_id);
      await client.query("UPDATE control.jobs SET current_step = $1 WHERE id = $2", [
        "check-runtime",
        job.id,
      ]);
      await recordStep(client, job.workspace_id, job.id, "check-runtime", "running");
      const result = await runHealth(client, job.workspace_id);
      await recordStep(client, job.workspace_id, job.id, "check-runtime", "succeeded");
      await recordStep(client, job.workspace_id, job.id, "record-result", "succeeded");
      await client.query(
        `INSERT INTO control.artifacts (workspace_id, job_id, type, digest, content)
         VALUES ($1, $2, 'health-result', $3, $4::jsonb)`,
        [
          job.workspace_id,
          job.id,
          sha256Hex(JSON.stringify(result)),
          JSON.stringify(result),
        ],
      );
      return result;
    });
  }

  if (job.workflow_id === "project.dailyBrief") {
    const projectId = job.payload.input.projectId;
    if (!projectId) {
      throw new ApiError(400, "schema_invalid", "daily brief requires projectId");
    }
    return withTransaction(pool, async (client) => {
      await setWorkspace(client, job.workspace_id);
      await client.query("UPDATE control.jobs SET current_step = $1 WHERE id = $2", [
        "generate-brief",
        job.id,
      ]);
      await recordStep(client, job.workspace_id, job.id, "load-tasks", "succeeded");
      await recordStep(client, job.workspace_id, job.id, "calculate-facts", "succeeded");
      await recordStep(client, job.workspace_id, job.id, "build-ai-context", "succeeded");
      const result = await runDailyBrief(client, projectId);
      await recordStep(client, job.workspace_id, job.id, "generate-brief", "succeeded");
      await recordStep(client, job.workspace_id, job.id, "validate-facts", "succeeded");
      await recordStep(client, job.workspace_id, job.id, "store-inbox", "succeeded");
      await client.query(
        `INSERT INTO control.artifacts (workspace_id, job_id, type, digest, content)
         VALUES ($1, $2, 'daily-brief', $3, $4::jsonb)`,
        [
          job.workspace_id,
          job.id,
          sha256Hex(JSON.stringify(result)),
          JSON.stringify(result),
        ],
      );
      return result;
    });
  }

  throw new Error(`unsupported workflow ${job.workflow_id}`);
}

export async function processNextJob(
  pool: DatabasePool,
  workspaceId: string,
): Promise<ClaimedJob | null> {
  const job = await claimJob(pool, workspaceId);
  if (!job) {
    return null;
  }
  try {
    const result = await executeClaimed(pool, job);
    await finishJob(pool, job, { state: "succeeded", result });
    return job;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown worker error";
    const code = error instanceof ApiError ? error.code : "execution_failed";
    await finishJob(pool, job, {
      state: "failed",
      error: { code, message },
    });
    return job;
  }
}

export async function processUntilIdle(
  pool: DatabasePool,
  workspaceId: string,
  maxJobs = 25,
): Promise<number> {
  let processed = 0;
  while (processed < maxJobs) {
    const job = await processNextJob(pool, workspaceId);
    if (!job) {
      break;
    }
    processed += 1;
  }
  return processed;
}
