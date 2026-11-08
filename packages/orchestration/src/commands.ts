import type { Actor } from "./auth.js";
import type { DatabaseClient, DatabasePool } from "./db.js";
import { setWorkspace, withTransaction } from "./db.js";
import { ApiError } from "./errors.js";
import { requestHash, traceId } from "./hash.js";
import { getJobRow, toJobResponse, type JobResponse } from "./jobs.js";
import { WORKFLOW } from "./ids.js";
import type { CommandInput } from "./validate.js";
import { validateCommand } from "./validate.js";

export type CommandAccepted = {
  commandId: string;
  jobId: string;
  state: string;
  replayed: boolean;
};

function workflowFor(action: CommandInput["action"]) {
  return action === "system.health" ? WORKFLOW.health : WORKFLOW.dailyBrief;
}

export async function submitCommand(
  pool: DatabasePool,
  actor: Actor,
  body: unknown,
): Promise<CommandAccepted> {
  let command: CommandInput;
  try {
    command = validateCommand(body);
  } catch (error) {
    const err = error as Error & { code?: string };
    throw new ApiError(400, err.code ?? "schema_invalid", err.message);
  }

  if (command.action === "project.dailyBrief") {
    const delivery = command.input.delivery;
    if (delivery === "pushcut") {
      throw new ApiError(
        400,
        "adapter_unconfigured",
        "Pushcut delivery is not enabled in Gate A; use inbox",
      );
    }
  }

  const hash = requestHash(command);
  const workflow = workflowFor(command.action);

  return withTransaction(pool, async (client) => {
    await setWorkspace(client, actor.workspaceId);

    if (command.action === "project.dailyBrief") {
      const projectId = String(command.input.projectId);
      const project = await client.query(
        `SELECT id FROM control.projects WHERE id = $1 AND status = 'active'`,
        [projectId],
      );
      if (project.rowCount === 0) {
        throw new ApiError(400, "project_not_found", "project not found");
      }
    }

    const existing = await client.query<{
      id: string;
      request_hash: string;
      job_id: string;
      state: string;
    }>(
      `SELECT c.id, c.request_hash, j.id AS job_id, j.state
         FROM control.commands c
         JOIN control.jobs j
           ON j.command_id = c.id AND j.workspace_id = c.workspace_id
        WHERE c.workspace_id = $1
          AND c.principal_id = $2
          AND c.idempotency_key = $3`,
      [actor.workspaceId, actor.principalId, command.idempotencyKey],
    );

    const prior = existing.rows[0];
    if (prior) {
      if (prior.request_hash !== hash) {
        throw new ApiError(
          409,
          "idempotency_conflict",
          "same idempotency key with a different request",
        );
      }
      return {
        commandId: prior.id,
        jobId: prior.job_id,
        state: prior.state,
        replayed: true,
      };
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO control.commands (
         workspace_id, principal_id, idempotency_key, request_hash, action, payload
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [
        actor.workspaceId,
        actor.principalId,
        command.idempotencyKey,
        hash,
        command.action,
        JSON.stringify(command),
      ],
    );
    const commandId = inserted.rows[0]?.id;
    if (!commandId) {
      throw new Error("command insert returned no id");
    }

    const job = await client.query<{ id: string }>(
      `INSERT INTO control.jobs (
         workspace_id, command_id, workflow_id, workflow_version, state,
         available_at, max_attempts, trace_id
       ) VALUES ($1, $2, $3, $4, 'queued', now(), 3, $5)
       RETURNING id`,
      [
        actor.workspaceId,
        commandId,
        workflow.id,
        workflow.version,
        traceId(),
      ],
    );
    const jobId = job.rows[0]?.id;
    if (!jobId) {
      throw new Error("job insert returned no id");
    }

    await client.query(
      `INSERT INTO control.outbox_events (workspace_id, type, payload, state)
       VALUES ($1, 'job.queued', $2::jsonb, 'pending')`,
      [actor.workspaceId, JSON.stringify({ commandId, jobId, action: command.action })],
    );
    await client.query(
      `INSERT INTO control.audit_events (workspace_id, job_id, type, actor_id, details)
       VALUES ($1, $2, 'command.accepted', $3, $4::jsonb)`,
      [
        actor.workspaceId,
        jobId,
        actor.principalId,
        JSON.stringify({ action: command.action, replayed: false }),
      ],
    );

    return {
      commandId,
      jobId,
      state: "queued" as const,
      replayed: false,
    };
  });
}

export async function getJob(
  pool: DatabasePool,
  actor: Actor,
  jobId: string,
): Promise<JobResponse> {
  return withTransaction(pool, async (client) => {
    await setWorkspace(client, actor.workspaceId);
    const row = await getJobRow(client, jobId);
    if (!row) {
      throw new ApiError(404, "job_not_found", "job not found");
    }
    return toJobResponse(row);
  });
}

export async function listCapabilities(pool: DatabasePool, actor: Actor) {
  return withTransaction(pool, async (client) => {
    await setWorkspace(client, actor.workspaceId);
    const result = await client.query<{ document: Record<string, unknown> }>(
      `SELECT document
         FROM control.definitions
        WHERE kind = 'capability'
          AND status = 'published'
          AND id IN ('system.health', 'project.dailyBrief')
        ORDER BY id`,
    );
    return { items: result.rows.map((row) => row.document) };
  });
}

export async function listInbox(
  pool: DatabasePool,
  actor: Actor,
  limit = 20,
) {
  return withTransaction(pool, async (client) => {
    await setWorkspace(client, actor.workspaceId);
    const result = await client.query<{
      id: string;
      job_id: string;
      type: string;
      created_at: Date;
      content: Record<string, unknown> | null;
    }>(
      `SELECT id, job_id, type, created_at, content
         FROM control.artifacts
        WHERE type IN ('daily-brief', 'health-result')
        ORDER BY created_at DESC
        LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        jobId: row.job_id,
        type: row.type,
        createdAt: row.created_at.toISOString(),
        content: row.content ?? {},
      })),
    };
  });
}

export async function pingDatabase(client: DatabaseClient): Promise<void> {
  await client.query("SELECT 1");
}
