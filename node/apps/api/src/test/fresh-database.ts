import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { join } from "node:path";
import { applyMigrations } from "../db/migrations";
import * as schema from "../db/schema";
import type { Database } from "../db/database";

const MIGRATIONS_DIR = join(__dirname, "../../drizzle");

/**
 * A throwaway database for one test.
 *
 * Runs against real PostgreSQL (PGlite is Postgres compiled to WASM), applying the
 * SAME generated migration SQL that production will run. Foreign keys, unique
 * constraints and defaults are therefore genuinely exercised — a schema that would
 * fail to create in production fails here first.
 */
export async function freshDatabase(): Promise<Database> {
  const client = await PGlite.create();
  await applyMigrations(MIGRATIONS_DIR, (statement) => client.exec(statement));
  return drizzle(client, { schema }) as unknown as Database;
}
