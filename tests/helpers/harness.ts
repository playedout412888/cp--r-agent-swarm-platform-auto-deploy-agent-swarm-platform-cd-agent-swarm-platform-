import pg from "pg";
import { buildApp } from "../../apps/api/src/server.js";
import { applyMigrations, resetControlSchema } from "../../database/migrate.js";
import { seedDatabase } from "../../database/seed.js";
import {
  createPool,
  SEED,
  type DatabasePool,
} from "../../packages/orchestration/src/index.js";

export type { DatabasePool };

export const TEST_TOKEN = process.env.CONTROL_PLANE_TOKEN ?? "local-dev-controller-token";
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://control:control@127.0.0.1:5432/control_plane_test";

export async function createTestPool(): Promise<DatabasePool> {
  return createPool(TEST_DATABASE_URL);
}

export async function resetAndSeed(pool: DatabasePool): Promise<void> {
  const client = await pool.connect();
  try {
    await resetControlSchema(client);
    await applyMigrations(client);
    await seedDatabase(client, TEST_TOKEN);
  } finally {
    client.release();
  }
}

export async function buildTestApp(pool: DatabasePool) {
  return buildApp(pool);
}

export function authHeader(token = TEST_TOKEN): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

export { SEED };

export async function assertPostgres(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } catch (error) {
    throw new Error(
      `PostgreSQL is required for Gate A tests at ${TEST_DATABASE_URL}: ${String(error)}`,
    );
  } finally {
    await client.end();
  }
}
