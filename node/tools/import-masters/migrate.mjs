/**
 * Applies the Drizzle migrations to a real PostgreSQL database.
 *
 * The API does NOT do this for you. `database.module.ts` applies migrations only
 * on the embedded PGlite path; when DATABASE_URL is set it simply connects, on
 * the assumption that a real server was migrated deliberately. So a fresh
 * database must be migrated here before anything is imported into it.
 *
 * The journal is the authority on order — never a directory listing. See
 * SESSION-HANDOFF.md section 7.3 for why that distinction cost real debugging time.
 *
 * Usage:
 *   $env:PGURL = "postgres://user:pass@127.0.0.1:5432/accountbook"
 *   node migrate.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Defaults to the repo layout. MIGRATIONS_DIR overrides it, because a deployed
 * release has no `apps/api` above it — the drizzle folder sits beside the
 * compiled output instead.
 */
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? join(HERE, "..", "..", "apps", "api", "drizzle");

const PGURL = process.env.PGURL;
if (!PGURL) {
  console.error("Set PGURL first, e.g.");
  console.error('  $env:PGURL = "postgres://postgres:PASSWORD@127.0.0.1:5432/accountbook"');
  process.exit(1);
}

function migrationStatements(dir) {
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));

  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error(`No migrations listed in ${journalPath}`);
  }

  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => ({
      tag: entry.tag,
      sql: readFileSync(join(dir, `${entry.tag}.sql`), "utf8"),
    }));
}

const sql = postgres(PGURL, { max: 1, onnotice: () => {} });

try {
  const migrations = migrationStatements(MIGRATIONS_DIR);
  console.log(`${migrations.length} migration(s) in the journal:\n`);

  for (const { tag, sql: body } of migrations) {
    // drizzle-kit separates statements within a file with this marker
    const statements = body
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    process.stdout.write(`  ${tag} — ${statements.length} statement(s) ... `);
    await sql.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement);
      }
    });
    console.log("ok");
  }

  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `;
  console.log(`\n${tables.length} tables now present:`);
  console.log("  " + tables.map((t) => t.table_name).join(", "));
} catch (error) {
  // A second run will fail on "already exists" — that is not a crash worth a stack trace.
  if (String(error.message).includes("already exists")) {
    console.log("\nAlready migrated (an object already exists). Nothing to do.");
    console.log("To start over: drop and recreate the database, then re-run.");
  } else {
    console.error("\nMigration failed:", error.message);
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
