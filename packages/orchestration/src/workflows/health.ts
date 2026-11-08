import type { DatabaseClient } from "../db.js";
import { assertHealthResult } from "../validate.js";

export async function runHealth(
  client: DatabaseClient,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const result = await client.query<{ paused: boolean }>(
    "SELECT paused FROM control.workspaces WHERE id = $1",
    [workspaceId],
  );
  const payload = {
    ok: true,
    checkedAt: new Date().toISOString(),
    workspacePaused: result.rows[0]?.paused ?? false,
  };
  assertHealthResult(payload);
  return payload;
}
