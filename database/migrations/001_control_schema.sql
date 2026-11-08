-- Reconstructured from the Control Plane V1 thread.
-- Provenance: reconstructed (see database/PROVENANCE.md). Not recovered from the original ZIP.

CREATE SCHEMA IF NOT EXISTS control;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'archived')),
  paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES control.workspaces (id),
  type text NOT NULL CHECK (type IN ('user', 'device', 'service')),
  role text NOT NULL CHECK (role IN ('owner', 'controller', 'worker', 'viewer')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'disabled')),
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);

CREATE TABLE control.credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'bearer' CHECK (kind IN ('bearer')),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (token_hash),
  FOREIGN KEY (workspace_id, principal_id)
    REFERENCES control.principals (workspace_id, id)
);

CREATE TABLE control.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  label text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'worker', 'other')),
  last_seen_at timestamptz,
  status text NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, principal_id)
    REFERENCES control.principals (workspace_id, id)
);

CREATE TABLE control.definitions (
  workspace_id uuid NOT NULL REFERENCES control.workspaces (id),
  id text NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('schema', 'capability', 'workflow', 'policy', 'context_document')),
  version text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id, version)
);

CREATE TABLE control.connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES control.workspaces (id),
  adapter text NOT NULL,
  credential_ref text,
  status text NOT NULL DEFAULT 'unconfigured'
    CHECK (status IN ('unconfigured', 'active', 'disabled', 'error')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(config) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, adapter)
);

CREATE TABLE control.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES control.workspaces (id),
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE control.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'blocked', 'done', 'cancelled')),
  due_at timestamptz,
  owner_ref text,
  depends_on uuid[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES control.projects (workspace_id, id)
);

CREATE TABLE control.commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  principal_id uuid NOT NULL,

  idempotency_key text NOT NULL
    CHECK (length(idempotency_key) BETWEEN 16 AND 128),

  request_hash text NOT NULL
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),

  action text NOT NULL,

  payload jsonb NOT NULL
    CHECK (jsonb_typeof(payload) = 'object'),

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, id),

  UNIQUE (
    workspace_id,
    principal_id,
    idempotency_key
  ),

  FOREIGN KEY (workspace_id, principal_id)
    REFERENCES control.principals (workspace_id, id)
);

CREATE TABLE control.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  command_id uuid NOT NULL,
  workflow_id text NOT NULL,
  workflow_version text NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN (
      'queued',
      'running',
      'succeeded',
      'waiting_approval',
      'retry_wait',
      'failed',
      'unknown',
      'cancelled'
    )),
  current_step text,
  lease_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  result jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, command_id),
  FOREIGN KEY (workspace_id, command_id)
    REFERENCES control.commands (workspace_id, id),
  FOREIGN KEY (workspace_id, workflow_id, workflow_version)
    REFERENCES control.definitions (workspace_id, id, version)
);

CREATE TABLE control.step_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  step_id text NOT NULL,
  state text NOT NULL
    CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'unknown', 'skipped')),
  input jsonb,
  result_ref uuid,
  error jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (job_id, step_id),
  FOREIGN KEY (workspace_id, job_id)
    REFERENCES control.jobs (workspace_id, id)
);

CREATE TABLE control.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  step_run_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  state text NOT NULL
    CHECK (state IN ('running', 'succeeded', 'failed', 'unknown')),
  error jsonb,
  provider_request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (step_run_id, attempt_number),
  FOREIGN KEY (workspace_id, step_run_id)
    REFERENCES control.step_runs (workspace_id, id)
);

CREATE TABLE control.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  action_payload jsonb NOT NULL CHECK (jsonb_typeof(action_payload) = 'object'),
  action_hash text NOT NULL CHECK (action_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, job_id)
    REFERENCES control.jobs (workspace_id, id)
);

CREATE TABLE control.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  action_hash text NOT NULL CHECK (action_hash ~ '^[0-9a-f]{64}$'),
  decision text CHECK (decision IN ('approved', 'rejected')),
  decided_by uuid,
  decided_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, proposal_id)
    REFERENCES control.proposals (workspace_id, id)
);

CREATE TABLE control.device_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  device_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, device_id)
    REFERENCES control.devices (workspace_id, id)
);

CREATE TABLE control.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  type text NOT NULL,
  storage_ref text,
  digest text CHECK (digest IS NULL OR digest ~ '^[0-9a-f]{64}$'),
  content jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, job_id)
    REFERENCES control.jobs (workspace_id, id)
);

CREATE TABLE control.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES control.workspaces (id),
  job_id uuid,
  type text NOT NULL,
  actor_id uuid,
  timestamp timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object'),
  UNIQUE (workspace_id, id)
);

CREATE TABLE control.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES control.workspaces (id),
  type text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'processing', 'delivered', 'failed')),
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);

CREATE INDEX jobs_claim_idx
  ON control.jobs (workspace_id, available_at, created_at)
  WHERE state IN ('queued', 'retry_wait');

CREATE INDEX artifacts_inbox_idx
  ON control.artifacts (workspace_id, created_at DESC);

CREATE INDEX audit_events_workspace_idx
  ON control.audit_events (workspace_id, timestamp DESC);

CREATE OR REPLACE FUNCTION control.prevent_published_definition_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'published definitions are immutable'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published definitions are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS definitions_published_immutable ON control.definitions;
CREATE TRIGGER definitions_published_immutable
  BEFORE UPDATE OR DELETE ON control.definitions
  FOR EACH ROW
  EXECUTE FUNCTION control.prevent_published_definition_mutation();

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'workspaces',
    'principals',
    'credentials',
    'devices',
    'definitions',
    'connections',
    'projects',
    'tasks',
    'commands',
    'jobs',
    'step_runs',
    'attempts',
    'proposals',
    'approvals',
    'device_events',
    'artifacts',
    'audit_events',
    'outbox_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE control.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE control.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS workspace_boundary ON control.%I', tbl);
    IF tbl = 'workspaces' THEN
      EXECUTE $policy$
        CREATE POLICY workspace_boundary ON control.workspaces
        USING (
          id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
        )
        WITH CHECK (
          id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
        )
      $policy$;
    ELSE
      EXECUTE format($policy$
        CREATE POLICY workspace_boundary ON control.%I
        USING (
          workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
        )
        WITH CHECK (
          workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
        )
      $policy$, tbl);
    END IF;
  END LOOP;
END
$$;
