import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertPostgres,
  createTestPool,
  resetAndSeed,
  SEED,
} from "../helpers/harness.js";
import { setWorkspace, type DatabasePool } from "../../packages/orchestration/src/index.js";

describe("migrations", () => {
  let pool: DatabasePool;

  beforeAll(async () => {
    await assertPostgres();
    pool = await createTestPool();
    await resetAndSeed(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates the 18 control tables", async () => {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'control'
        ORDER BY table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "approvals",
      "artifacts",
      "attempts",
      "audit_events",
      "commands",
      "connections",
      "credentials",
      "definitions",
      "device_events",
      "devices",
      "jobs",
      "outbox_events",
      "principals",
      "projects",
      "proposals",
      "step_runs",
      "tasks",
      "workspaces",
    ]);
  });

  it("records the reconstructed migration", async () => {
    const result = await pool.query("SELECT id FROM public.schema_migrations");
    expect(result.rows.map((row) => row.id)).toContain("001_control_schema.sql");
  });

  it("keeps published definitions immutable", async () => {
    const client = await pool.connect();
    try {
      await setWorkspace(client, SEED.workspaceId);
      await expect(
        client.query(
          `UPDATE control.definitions SET digest = repeat('a', 64)
            WHERE id = 'system.health' AND kind = 'workflow'`,
        ),
      ).rejects.toThrow(/immutable/);
    } finally {
      client.release();
    }
  });
});
