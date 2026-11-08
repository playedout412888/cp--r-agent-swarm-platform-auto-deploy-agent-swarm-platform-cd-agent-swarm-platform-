import pg from "pg";

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;
export type SqlClient = {
  query: pg.PoolClient["query"];
};

export function createPool(databaseUrl: string): DatabasePool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
  });
}

export async function withTransaction<T>(
  pool: DatabasePool,
  fn: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setWorkspace(
  client: SqlClient,
  workspaceId: string,
): Promise<void> {
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [
    workspaceId,
  ]);
}
