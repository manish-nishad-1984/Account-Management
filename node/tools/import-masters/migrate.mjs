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
  /**
   * Which migrations have already run.
   *
   * Without this the runner replayed the journal from the beginning on every
   * deploy, hit "relation already exists" on migration 0000, and stopped —
   * reporting "Already migrated. Nothing to do." while every migration added
   * since the last run was silently skipped. The deploy looked clean and the new
   * tables were simply absent, which surfaced later as a 500 from the endpoint
   * that needed them.
   */
  const [existing] = await sql`select to_regclass('public.applied_migrations') as table`;
  const firstRun = existing?.table === null;

  await sql.unsafe(`
    create table if not exists applied_migrations (
      tag text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const applied = new Set(
    (await sql`select tag from applied_migrations`).map((row) => row.tag),
  );

  if (firstRun) {
    console.log("No tracking table yet — adopting whatever is already in the schema.\n");
  }

  const migrations = migrationStatements(MIGRATIONS_DIR);
  console.log(`${migrations.length} migration(s) in the journal, ${applied.size} already applied:\n`);

  let ran = 0;
  let adopted = 0;

  for (const { tag, sql: body } of migrations) {
    if (applied.has(tag)) {
      console.log(`  ${tag} — already applied`);
      continue;
    }

    // drizzle-kit separates statements within a file with this marker
    const statements = body
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    process.stdout.write(`  ${tag} — ${statements.length} statement(s) ... `);
    try {
      // One transaction per migration, so a file is applied wholly or not at all
      // and the recorded tag can never describe a half-applied schema.
      await sql.begin(async (tx) => {
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
        await tx`insert into applied_migrations ${tx({ tag })}`;
      });
      ran += 1;
      console.log("ok");
    } catch (error) {
      /**
       * On the FIRST run these errors mean the migration was applied before the
       * tracking table existed — true of every database the previous version of
       * this script migrated. Adopt it: record the tag and carry on to the ones
       * that have not run. Aborting here is the bug this replaces.
       *
       * Matched by SQLSTATE, not by message text, because an already-applied
       * migration fails differently depending on what it did: CREATE reports
       * "already exists" (42P07/42710), a DROP reports "does not exist"
       * (42703/42704), ADD COLUMN reports a duplicate column (42701).
       *
       * Only on the first run. Once the table is populated, any of these is a
       * real failure and must not be swallowed.
       */
      const ADOPTABLE = new Set(["42P07", "42P06", "42710", "42701", "42703", "42704"]);
      if (firstRun && ADOPTABLE.has(error.code)) {
        await sql`insert into applied_migrations ${sql({ tag })} on conflict do nothing`;
        adopted += 1;
        console.log("already in the schema — recorded, not re-run");
      } else {
        throw error;
      }
    }
  }

  console.log(`\n${ran} applied, ${adopted} adopted, ${applied.size} skipped.`);

  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `;
  console.log(`${tables.length} tables now present:`);
  console.log("  " + tables.map((t) => t.table_name).join(", "));
} catch (error) {
  console.error("\nMigration failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
