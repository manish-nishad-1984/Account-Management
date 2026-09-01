import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads the generated migrations in the order drizzle-kit recorded them.
 *
 * This exists because the obvious shortcut is wrong: the first version of this
 * loader did `readdirSync(dir).find(f => f.endsWith(".sql"))`, which silently
 * applied migration 0000 and ignored every one after it. With a single migration
 * that behaves identically to the correct code, so nothing failed until a second
 * one was added — and then it failed as a missing table, a long way from the
 * cause. The journal is the authority on order; directory listing order is not.
 */

interface Journal {
  entries: { idx: number; tag: string }[];
}

export function migrationStatements(migrationsDir: string): string[] {
  const journalPath = join(migrationsDir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;

  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error(`No migrations listed in ${journalPath}. Run: npm run db:generate`);
  }

  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .flatMap((entry) =>
      readFileSync(join(migrationsDir, `${entry.tag}.sql`), "utf8")
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean),
    );
}

/** Applies every migration, in order, through whatever executor is given. */
export async function applyMigrations(
  migrationsDir: string,
  exec: (statement: string) => Promise<unknown>,
): Promise<number> {
  const statements = migrationStatements(migrationsDir);
  for (const statement of statements) {
    await exec(statement);
  }
  return statements.length;
}
