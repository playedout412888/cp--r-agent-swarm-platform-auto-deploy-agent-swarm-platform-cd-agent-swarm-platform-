import type pg from "pg";
import { SEED, WORKFLOW } from "../packages/orchestration/src/ids.js";
import { canonicalize, sha256Hex } from "../packages/orchestration/src/hash.js";
import { setWorkspace } from "../packages/orchestration/src/db.js";

function definition(
  id: string,
  kind: string,
  version: string,
  document: Record<string, unknown>,
) {
  return {
    id,
    kind,
    version,
    document,
    digest: sha256Hex(canonicalize(document)),
  };
}

const healthWorkflow = {
  id: WORKFLOW.health.id,
  version: WORKFLOW.health.version,
  steps: [
    { id: "check-runtime", capability: "system.health", sideEffectClass: "none" },
    { id: "record-result", capability: "system.health", sideEffectClass: "internal" },
  ],
};

const briefWorkflow = {
  id: WORKFLOW.dailyBrief.id,
  version: WORKFLOW.dailyBrief.version,
  steps: [
    { id: "load-tasks", capability: "project.dailyBrief", sideEffectClass: "none" },
    { id: "calculate-facts", capability: "project.dailyBrief", sideEffectClass: "none" },
    { id: "build-ai-context", capability: "project.dailyBrief", sideEffectClass: "none" },
    { id: "generate-brief", capability: "project.dailyBrief", sideEffectClass: "none" },
    { id: "validate-facts", capability: "project.dailyBrief", sideEffectClass: "none" },
    { id: "store-inbox", capability: "project.dailyBrief", sideEffectClass: "internal" },
    { id: "notify", capability: "project.dailyBrief", sideEffectClass: "internal" },
  ],
};

const healthCapability = {
  id: "system.health",
  version: "1.0.0",
  adapter: "internal",
  inputSchemaRef: "urn:control-plane:command:v1",
  outputSchemaRef: "urn:control-plane:health-result:v1",
  requiredPermissions: ["system.health"],
  executionTarget: "cloud-worker",
  sideEffectClass: "none",
  approvalPolicyRef: null,
  timeoutSeconds: 10,
  retryPolicy: { maxAttempts: 1, onAmbiguousDelivery: "mark-unknown" },
};

const briefCapability = {
  id: "project.dailyBrief",
  version: "1.0.0",
  adapter: "internal",
  inputSchemaRef: "urn:control-plane:command:v1",
  outputSchemaRef: "urn:control-plane:daily-brief-result:v1",
  requiredPermissions: ["project.dailyBrief"],
  executionTarget: "cloud-worker",
  sideEffectClass: "none",
  approvalPolicyRef: null,
  timeoutSeconds: 20,
  retryPolicy: { maxAttempts: 1, onAmbiguousDelivery: "mark-unknown" },
};

const definitions = [
  definition("system.health", "workflow", WORKFLOW.health.version, healthWorkflow),
  definition("project.dailyBrief", "workflow", WORKFLOW.dailyBrief.version, briefWorkflow),
  definition("system.health", "capability", "1.0.0", healthCapability),
  definition("project.dailyBrief", "capability", "1.0.0", briefCapability),
  definition("urn:control-plane:command:v1", "schema", "1.0", {
    id: "urn:control-plane:command:v1",
    version: "1.0",
  }),
];

export async function seedDatabase(
  client: pg.Client | pg.PoolClient,
  token: string,
): Promise<void> {
  await client.query(
    `INSERT INTO control.workspaces (id, name, timezone, status, paused)
     VALUES ($1, 'personal', 'America/New_York', 'active', false)
     ON CONFLICT (id) DO NOTHING`,
    [SEED.workspaceId],
  );
  await setWorkspace(client, SEED.workspaceId);

  await client.query(
    `INSERT INTO control.principals (id, workspace_id, type, role, status, display_name)
     VALUES ($1, $2, 'user', 'owner', 'active', 'owner'),
            ($3, $2, 'device', 'controller', 'active', 'local-controller')
     ON CONFLICT (workspace_id, id) DO NOTHING`,
    [SEED.ownerPrincipalId, SEED.workspaceId, SEED.controllerPrincipalId],
  );

  const tokenHash = sha256Hex(token);
  await client.query(
    `INSERT INTO control.credentials (
       id, workspace_id, principal_id, kind, token_hash, label, status
     ) VALUES ($1, $2, $3, 'bearer', $4, 'local-bootstrap', 'active')
     ON CONFLICT (workspace_id, id) DO UPDATE SET token_hash = EXCLUDED.token_hash`,
    [SEED.credentialId, SEED.workspaceId, SEED.controllerPrincipalId, tokenHash],
  );

  for (const item of definitions) {
    await client.query(
      `INSERT INTO control.definitions (
         workspace_id, id, kind, version, document, digest, status
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'published')
       ON CONFLICT (workspace_id, id, version) DO NOTHING`,
      [SEED.workspaceId, item.id, item.kind, item.version, JSON.stringify(item.document), item.digest],
    );
  }

  await client.query(
    `INSERT INTO control.connections (workspace_id, adapter, credential_ref, status, config)
     VALUES ($1, 'inbox', NULL, 'active', '{}'::jsonb),
            ($1, 'pushcut', NULL, 'unconfigured', '{}'::jsonb)
     ON CONFLICT (workspace_id, adapter) DO NOTHING`,
    [SEED.workspaceId],
  );

  await client.query(
    `INSERT INTO control.projects (id, workspace_id, slug, name, status)
     VALUES ($1, $2, 'personal-ops', 'Personal operating system', 'active')
     ON CONFLICT (workspace_id, id) DO NOTHING`,
    [SEED.projectId, SEED.workspaceId],
  );

  await client.query(
    `INSERT INTO control.tasks (
       id, workspace_id, project_id, title, status, due_at, owner_ref, depends_on, notes
     ) VALUES
       ($3, $2, $1, 'Ship Gate A contracts', 'open', now() + interval '2 days', 'owner', '{}', 'has a due date'),
       ($4, $2, $1, 'Unblock identity bootstrap', 'blocked', now() + interval '5 days', 'owner', ARRAY[$3]::uuid[], 'depends on Gate A task'),
       ($5, $2, $1, 'Capture remaining context', 'open', NULL, NULL, '{}', 'missing date and owner')
     ON CONFLICT (workspace_id, id) DO NOTHING`,
    [
      SEED.projectId,
      SEED.workspaceId,
      SEED.taskDueId,
      SEED.taskBlockedId,
      SEED.taskMissingDateId,
    ],
  );
}
