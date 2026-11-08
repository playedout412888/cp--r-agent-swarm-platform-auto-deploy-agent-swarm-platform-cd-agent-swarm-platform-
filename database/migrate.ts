import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "../packages/orchestration/src/config.js";
import { seedDatabase } from "./seed.js";

const here = dirname(fileURLToPath(import.meta.url));

export async function applyMigrations(client: pg.Client | pg.PoolClient): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const dir = join(here, "migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    const existing = await client.query("SELECT 1 FROM public.schema_migrations WHERE id = $1", [
      file,
    ]);
    if ((existing.rowCount ?? 0) > 0) {
      continue;
    }
    const sql = await readFile(join(dir, file), "utf8");
    await client.query(sql);
    await client.query("INSERT INTO public.schema_migrations (id) VALUES ($1)", [file]);
    applied.push(file);
  }
  return applied;
}

export async function resetControlSchema(client: pg.Client | pg.PoolClient): Promise<void> {
  await client.query("DROP SCHEMA IF EXISTS control CASCADE");
  await client.query("DROP TABLE IF EXISTS public.schema_migrations");
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";
  const config = loadConfig();
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    if (command === "reset") {
      await resetControlSchema(client);
      await applyMigrations(client);
      await seedDatabase(client, config.token);
      return;
    }
    if (command === "up") {
      const applied = await applyMigrations(client);
      process.stdout.write(
        applied.length === 0 ? "migrations already applied\n" : `applied ${applied.join(", ")}\n`,
      );
      return;
    }
    if (command === "seed") {
      await seedDatabase(client, config.token);
      process.stdout.write("seed complete\n");
      return;
    }
    throw new Error(`unknown migrate command ${command}`);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
