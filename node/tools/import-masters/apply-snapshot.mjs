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
 * with PGURL in the environment — or DATABASE_URL, which is the name the
 * release's own `.env` on the server already uses, so this can be run there as
 *
 *   node --env-file=<release>/api/.env apply-snapshot.mjs <file.json>
 *
 * without anyone retyping the database password or editing that file.
 *
 * EVERYTHING IS ONE TRANSACTION. The truncate and every insert commit together
 * or not at all, so a failure halfway leaves the database exactly as it was
 * rather than emptied.
 */

const FILE = process.argv[2];
const DRY_RUN = process.argv.includes("--dry-run");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL;

if (!FILE || !PGURL) {
  console.error("Usage: PGURL=postgres://... node apply-snapshot.mjs <file.json> [--dry-run]");
  console.error("       DATABASE_URL is accepted in place of PGURL.");
  process.exit(1);
}

/**
 * FALLBACK ONLY, for master snapshots written before `__meta.truncate` existed.
 *
 * A copy of a list that lives somewhere else is a copy that goes stale, and this
 * one did: when the geography and site-address tables were added to `import.mjs`
 * they were missing here, so applying an old snapshot would have left the four
 * new tables untouched while replacing everything around them. `import.mjs` now
 * writes its own list into the snapshot and that is what is used; this survives
 * only to keep snapshots taken before that readable.
 */
const MASTER_TRUNCATE = [
  "site_addresses",
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
  "cities",
  "states",
  "countries",
];

const snapshot = JSON.parse(readFileSync(FILE, "utf8"));
const meta = snapshot.__meta ?? {};
const tables = Object.keys(snapshot).filter((key) => key !== "__meta");

/**
 * `kind` is written by both importers now. The older test — "no truncate list
 * means masters" — broke the moment `import.mjs` started writing one, because a
 * master snapshot then read as transactional and lost its `restart identity`.
 * Fall back to that test only for snapshots written before `kind` existed.
 */
const isMasters = meta.kind ? meta.kind === "masters" : !meta.truncate;
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

    /**
     * PUT THE IDENTITY SEQUENCES BACK, and this was a real defect until now.
     *
     * A few tables take the source's own ids into a generated-by-default identity
     * column. `truncate ... restart identity` sets each sequence to 1, and
     * inserting explicit ids does not advance it — so after a load the sequence
     * still says 1 while the table holds ids up to 82, and the FIRST unit anyone
     * creates in the app fails on a duplicate key.
     *
     * `import.mjs` has always done this on its direct-load path; this file did
     * not, so every snapshot load left production in that state. It was found on
     * a live database whose units sequence was at 1 against a maximum id of 82.
     *
     * Older snapshots carry no `resetSequences`, so the known set is the default.
     */
    const resetSequences = meta.resetSequences ?? ["units", "forms", "site_addresses"];
    const reset = resetSequences.filter((t) => tables.includes(t) && snapshot[t].length > 0);
    if (reset.length > 0) {
      console.log("Resetting identity sequences ...");
      for (const table of reset) {
        const [{ seq }] = await tx`select pg_get_serial_sequence(${table}, 'id') as seq`;
        if (!seq) {
          console.log(`  ${table.padEnd(36)}   no identity sequence, skipped`);
          continue;
        }
        const [{ max }] = await tx.unsafe(`select max(id) as max from ${table}`);
        await tx.unsafe(`select setval('${seq}', ${Number(max)})`);
        console.log(`  ${table.padEnd(36)} ${String(max).padStart(6)}  next id is ${Number(max) + 1}`);
      }
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
