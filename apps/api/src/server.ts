import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import {
  ApiError,
  authenticate,
  errorBody,
  getJob,
  listCapabilities,
  listInbox,
  pingDatabase,
  submitCommand,
  type DatabasePool,
} from "../../../packages/orchestration/src/index.js";

function requestId(header: unknown): string {
  return typeof header === "string" && header.length > 0 ? header : randomUUID();
}

export async function buildApp(pool: DatabasePool) {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, request, reply) => {
    const id = requestId(request.headers["x-request-id"]);
    if (error instanceof ApiError) {
      void reply.status(error.statusCode).send(errorBody(error, id));
      return;
    }
    request.log.error(error);
    void reply.status(500).send(
      errorBody(new ApiError(500, "internal_error", "internal error"), id),
    );
  });

  app.get("/v1/health", async () => ({ status: "ok" }));

  app.get("/v1/readiness", async (request) => {
    const actor = await authenticate(pool, request.headers.authorization);
    const client = await pool.connect();
    try {
      await pingDatabase(client);
    } catch {
      throw new ApiError(503, "not_ready", "database unreachable");
    } finally {
      client.release();
    }
    void actor;
    return { status: "ready", database: "reachable" };
  });

  app.post("/v1/commands", async (request, reply) => {
    const actor = await authenticate(pool, request.headers.authorization);
    const accepted = await submitCommand(pool, actor, request.body);
    void reply
      .status(202)
      .header("Location", `/v1/jobs/${accepted.jobId}`)
      .send(accepted);
  });

  app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (request) => {
    const actor = await authenticate(pool, request.headers.authorization);
    return getJob(pool, actor, request.params.id);
  });

  app.get("/v1/capabilities", async (request) => {
    const actor = await authenticate(pool, request.headers.authorization);
    return listCapabilities(pool, actor);
  });

  app.get<{ Querystring: { limit?: string } }>("/v1/inbox", async (request) => {
    const actor = await authenticate(pool, request.headers.authorization);
    const limit = request.query.limit ? Number(request.query.limit) : 20;
    return listInbox(pool, actor, Number.isFinite(limit) ? limit : 20);
  });

  const deferred = async () => {
    throw new ApiError(501, "gate_deferred", "this operation is not part of Gate A");
  };
  app.get("/v1/approvals/:id", deferred);
  app.post("/v1/approvals/:id/decision", deferred);
  app.post("/v1/device-events", deferred);

  return app;
}
