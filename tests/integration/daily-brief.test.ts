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

describe("project.dailyBrief", () => {
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

  it("runs the brief on seed project data without live AI keys", async () => {
    expect(process.env.AI_PROVIDER_API_KEY ?? "").toBe("");

    const submitted = await app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: authHeader(),
      payload: {
        schemaVersion: "1.0",
        idempotencyKey: "brief-test-20261006-0001",
        action: "project.dailyBrief",
        input: {
          projectId: SEED.projectId,
          delivery: "inbox",
        },
      },
    });
    expect(submitted.statusCode).toBe(202);
    const body = submitted.json() as { jobId: string };
    await processUntilIdle(pool, SEED.workspaceId);

    const job = await app.inject({
      method: "GET",
      url: `/v1/jobs/${body.jobId}`,
      headers: authHeader(),
    });
    expect(job.statusCode).toBe(200);
    const record = job.json() as {
      state: string;
      result: {
        projectId: string;
        facts: { openCount: number; referencedTaskIds: string[] };
        missingInformation: string[];
        aiGeneration: { status: string; reason: string };
        delivery: string;
      };
    };
    expect(record.state).toBe("succeeded");
    expect(record.result.projectId).toBe(SEED.projectId);
    expect(record.result.delivery).toBe("inbox");
    expect(record.result.facts.openCount).toBe(3);
    expect(record.result.facts.referencedTaskIds).toEqual(
      expect.arrayContaining([SEED.taskDueId, SEED.taskBlockedId, SEED.taskMissingDateId]),
    );
    expect(record.result.missingInformation.length).toBeGreaterThan(0);
    expect(record.result.aiGeneration).toEqual({
      status: "skipped",
      reason: "missing_api_key",
    });

    const inbox = await app.inject({
      method: "GET",
      url: "/v1/inbox",
      headers: authHeader(),
    });
    expect(inbox.statusCode).toBe(200);
    const items = inbox.json() as { items: Array<{ jobId: string; type: string }> };
    expect(items.items.some((item) => item.jobId === body.jobId && item.type === "daily-brief")).toBe(
      true,
    );
  });

  it("does not enable Pushcut delivery", async () => {
    const submitted = await app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: authHeader(),
      payload: {
        schemaVersion: "1.0",
        idempotencyKey: "brief-pushcut-not-enabled",
        action: "project.dailyBrief",
        input: {
          projectId: SEED.projectId,
          delivery: "pushcut",
        },
      },
    });
    expect(submitted.statusCode).toBe(400);
    expect(submitted.json()).toMatchObject({
      error: { code: "adapter_unconfigured" },
    });
  });
});
