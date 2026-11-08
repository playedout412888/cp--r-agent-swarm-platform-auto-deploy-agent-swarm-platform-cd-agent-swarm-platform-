import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processUntilIdle } from "../../packages/orchestration/src/index.js";
import {
  assertPostgres,
  authHeader,
  buildTestApp,
  createTestPool,
  resetAndSeed,
  SEED,
  type DatabasePool,
} from "../helpers/harness.js";

describe("system.health", () => {
  let pool: DatabasePool;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    await assertPostgres();
    pool = await createTestPool();
    await resetAndSeed(pool);
    app = await buildTestApp(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("returns public liveness without a token", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("accepts a health command, runs the worker, and returns the recorded result", async () => {
    const submitted = await app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: authHeader(),
      payload: {
        schemaVersion: "1.0",
        idempotencyKey: "health-test-20261006-0001",
        action: "system.health",
        input: {},
      },
    });
    expect(submitted.statusCode).toBe(202);
    const body = submitted.json() as {
      commandId: string;
      jobId: string;
      state: string;
      replayed: boolean;
    };
    expect(body.replayed).toBe(false);
    expect(body.state).toBe("queued");
    expect(submitted.headers.location).toBe(`/v1/jobs/${body.jobId}`);

    await processUntilIdle(pool, SEED.workspaceId);

    const job = await app.inject({
      method: "GET",
      url: `/v1/jobs/${body.jobId}`,
      headers: authHeader(),
    });
    expect(job.statusCode).toBe(200);
    const record = job.json() as {
      state: string;
      result: { ok: boolean };
      error: null;
    };
    expect(record.state).toBe("succeeded");
    expect(record.result.ok).toBe(true);
    expect(record.error).toBeNull();

    const replay = await app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: authHeader(),
      payload: {
        schemaVersion: "1.0",
        idempotencyKey: "health-test-20261006-0001",
        action: "system.health",
        input: {},
      },
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({
      commandId: body.commandId,
      jobId: body.jobId,
      replayed: true,
    });
  });
});
