import { readFileSync } from "node:fs";
import postgres from "postgres";

/**
 * Inserts a snapshot written by `import.mjs --snapshot` or
 * `transactions.mjs --snapshot`, wherever this is run.
 *
 * WHY THIS EXISTS AT ALL. The two importers read SQL Server and would happily
 * write straight into the target — but the target is a PostgreSQL bound to
 * loopback on the server, and this environment has no route to it. So the read
 * and the write are separated: the snapshot is produced next to SQL Server,
 * copied across, and applied next to PostgreSQL.
 *
 * The separation turned out to be worth having for its own sake. The snapshot
 * is the exact set of rows that will be inserted, in JSON, so it can be read
 * before anything is written — which a live connection cannot offer. And the
 * expensive half (reading 2,599 invoices and 3,052 lines, recomputing every
 * total) happens once, not again on each attempt.
 *
 *   node apply-snapshot.mjs <file.json> [--dry-run]
 *
 * with PGURL in the environment.
 *
 * EVERYTHING IS ONE TRANSACTION. The truncate and every insert commit together
 * or not at all, so a failure halfway leaves the database exactly as it was
 * rather than emptied.
 */

const FILE = process.argv[2];
const DRY_RUN = process.argv.includes("--dry-run");
const PGURL = process.env.PGURL;

if (!FILE || !PGURL) {
  console.error("Usage: PGURL=postgres://... node apply-snapshot.mjs <file.json> [--dry-run]");
  process.exit(1);
}

/**
 * The master snapshot predates `__meta.truncate`, so its list lives here.
 * Children first; `restart identity cascade` matches what `import.mjs` does
 * when it loads directly.
 */
const MASTER_TRUNCATE = [
  "document_counters",
  "inward_challan_documents",
  "inward_challans",
  "inventory_inward",
  "purchase_requests",
  "refresh_tokens",
  "user_form_permissions",
  "user_sites",
  "user_companies",
  "site_group_addresses",
  "site_group_sites",
  "site_groups",
  "items",
  "suppliers",
  "sites",
  "companies",
  "users",
  "forms",
  "units",
];

const snapshot = JSON.parse(readFileSync(FILE, "utf8"));
const meta = snapshot.__meta ?? {};
const tables = Object.keys(snapshot).filter((key) => key !== "__meta");

const isMasters = !meta.truncate;
const truncate = meta.truncate ?? MASTER_TRUNCATE;

console.log(`Snapshot   ${FILE}`);
console.log(`Written    ${meta.generatedAt ?? meta.writtenAt ?? "unknown"}`);
console.log(`Source     ${meta.source ?? "unknown"}`);
console.log(`Kind       ${isMasters ? "masters" : "transactions"}\n`);

let total = 0;
for (const table of tables) {
  console.log(`  ${table.padEnd(36)} ${String(snapshot[table].length).padStart(6)}`);
  total += snapshot[table].length;
}
console.log(`  ${"".padEnd(36)} ${String(total).padStart(6)} rows in total`);

if (Array.isArray(meta.notes) && meta.notes.length > 0) {
  console.log("\nNotes carried with the snapshot:");
  for (const note of meta.notes) console.log(`  - ${note}`);
}

if (DRY_RUN) {
  console.log("\n--dry-run: nothing was written.");
  process.exit(0);
}

const pg = postgres(PGURL, { max: 1, onnotice: () => {} });

try {
  const before = await pg`
    select relname as table, n_live_tup as rows
    from pg_stat_user_tables order by relname`;

  await pg.begin(async (tx) => {
    console.log(`\nTruncating ${truncate.length} table(s) ...`);
    await tx.unsafe(
      `truncate table ${truncate.join(", ")} ${isMasters ? "restart identity " : ""}cascade`,
    );

    console.log("Inserting ...");
    for (const table of tables) {
      const rows = snapshot[table];
      if (rows.length === 0) {
        console.log(`  ${table.padEnd(36)}      0`);
        continue;
      }
      // Chunked: a wide table with thousands of rows would otherwise exceed
      // PostgreSQL's bind-parameter limit and fail the whole transaction.
      const size = 500;
      for (let i = 0; i < rows.length; i += size) {
        await tx`insert into ${tx(table)} ${tx(rows.slice(i, i + size))}`;
      }
      console.log(`  ${table.padEnd(36)} ${String(rows.length).padStart(6)}`);
    }
  });

  console.log("\nCommitted. Row counts that changed:");
  const after = await pg`
    select relname as table, n_live_tup as rows
    from pg_stat_user_tables order by relname`;
  const was = new Map(before.map((r) => [r.table, Number(r.rows)]));
  for (const row of after) {
    const from = was.get(row.table) ?? 0;
    const to = Number(row.rows);
    if (from !== to) {
      console.log(`  ${row.table.padEnd(36)} ${String(from).padStart(6)} -> ${String(to).padStart(6)}`);
    }
  }
} finally {
  await pg.end();
}
