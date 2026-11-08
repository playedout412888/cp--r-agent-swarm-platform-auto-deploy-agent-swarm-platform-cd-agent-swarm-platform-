import { ApiError } from "./errors.js";
import type { DatabasePool } from "./db.js";
import { sha256Hex } from "./hash.js";

export type Actor = {
  credentialId: string;
  workspaceId: string;
  principalId: string;
};

export async function authenticate(
  pool: DatabasePool,
  authorizationHeader: string | undefined,
): Promise<Actor> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new ApiError(401, "unauthenticated", "missing bearer token");
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new ApiError(401, "unauthenticated", "missing bearer token");
  }
  const tokenHash = sha256Hex(token);
  const result = await pool.query<{
    id: string;
    workspace_id: string;
    principal_id: string;
    status: string;
    principal_status: string;
    expires_at: Date | null;
  }>(
    `SELECT c.id, c.workspace_id, c.principal_id, c.status, c.expires_at,
            p.status AS principal_status
       FROM control.credentials c
       JOIN control.principals p
         ON p.id = c.principal_id AND p.workspace_id = c.workspace_id
      WHERE c.token_hash = $1`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row || row.status !== "active" || row.principal_status !== "active") {
    throw new ApiError(401, "unauthenticated", "invalid or revoked credential");
  }
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
    throw new ApiError(401, "unauthenticated", "invalid or revoked credential");
  }
  return {
    credentialId: row.id,
    workspaceId: row.workspace_id,
    principalId: row.principal_id,
  };
}
