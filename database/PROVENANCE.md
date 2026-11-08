# Database provenance

**Status:** reconstructed, not recovered from the original Control Plane V1 ZIP.

The prior thread recorded generation of a starter PostgreSQL migration, then confirmed those files were **not** in the build workspace. Gate A restores the agreed baseline from the conversation record instead of inventing a second architecture.

## Source fragments (thread)

- Entity list and invariants: “show me the core data structure…”
- 18-table grouping, `control.commands` DDL, RLS `app.workspace_id` policy, worker claim SQL: “show me the database migration SQL…”
- Unified `definitions` table for schemas, capabilities, workflows, and policies; published rows immutable
- Job claim fields: `state`, `available_at`, `attempts`, `max_attempts`, `lease_token`, `lease_expires_at`, `workspaces.paused`
- Seed-before-jobs rule from the scope freeze / Gate A ledger

## Assembled to complete the recorded 18-table migration

Table bodies other than `control.commands` were not pasted in full. Columns follow the thread’s entity field list, the claim SQL, and the required brief structures (projects, tasks, `depends_on`). `public.schema_migrations` is a runner catalog only and is not one of the 18 control tables.

Do not treat this SQL as a recovered binary artifact. Validate by applying it and running the Gate A tests.
