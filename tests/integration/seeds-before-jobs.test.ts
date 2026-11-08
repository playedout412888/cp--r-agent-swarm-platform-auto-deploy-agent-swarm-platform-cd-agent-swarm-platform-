import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertPostgres,
  createTestPool,
  resetAndSeed,
  SEED,
} from "../helpers/harness.js";
import { setWorkspace, type DatabasePool } from "../../packages/orchestration/src/index.js";

describe("seeds before jobs", () => {
  let pool: DatabasePool;

  beforeAll(async () => {
    await assertPostgres();
    pool = await createTestPool();
    await resetAndSeed(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("rejects a job whose workflow definition is missing", async () => {
    const client = await pool.connect();
    try {
      await setWorkspace(client, SEED.workspaceId);
      await client.query("BEGIN");
      const command = await client.query<{ id: string }>(
        `INSERT INTO control.commands (
           workspace_id, principal_id, idempotency_key, request_hash, action, payload
         ) VALUES ($1, $2, 'seed-before-jobs-01', $3, 'system.health', '{}'::jsonb)
         RETURNING id`,
        [SEED.workspaceId, SEED.controllerPrincipalId, "a".repeat(64)],
      );
      await expect(
        client.query(
          `INSERT INTO control.jobs (
             workspace_id, command_id, workflow_id, workflow_version, trace_id
           ) VALUES ($1, $2, 'missing.workflow', '1.0.0', $3)`,
          [SEED.workspaceId, command.rows[0]?.id, "b".repeat(32)],
        ),
      ).rejects.toThrow(/foreign key|definitions/i);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("inserts a job only after the seeded workflow exists", async () => {
    const client = await pool.connect();
    try {
      await setWorkspace(client, SEED.workspaceId);
      const seeded = await client.query(
        `SELECT 1 FROM control.definitions
          WHERE id = 'system.health' AND kind = 'workflow' AND version = '1.0.0'`,
      );
      expect(seeded.rowCount).toBe(1);

      const command = await client.query<{ id: string }>(
        `INSERT INTO control.commands (
           workspace_id, principal_id, idempotency_key, request_hash, action, payload
         ) VALUES ($1, $2, 'seed-before-jobs-02', $3, 'system.health', '{}'::jsonb)
         RETURNING id`,
        [SEED.workspaceId, SEED.controllerPrincipalId, "c".repeat(64)],
      );
      const job = await client.query(
        `INSERT INTO control.jobs (
           workspace_id, command_id, workflow_id, workflow_version, trace_id
         ) VALUES ($1, $2, 'system.health', '1.0.0', $3)
         RETURNING id`,
        [SEED.workspaceId, command.rows[0]?.id, "d".repeat(32)],
      );
      expect(job.rowCount).toBe(1);
    } finally {
      client.release();
    }
  });
});
