import { readFileSync } from "node:fs";
import postgres from "postgres";

/**
 * RESYNC from the legacy database WITHOUT losing what the new app added
 * (client, 15 Oct 2026).
 *
 *   node --env-file=<release>/api/.env apply-resync.mjs <masters.json> <transactions.json> [--dry-run]
 *
 * The two snapshots come from `import.mjs --snapshot` and `transactions.mjs
 * --masters <masters.json> --snapshot`, exactly as for `apply-snapshot.mjs`.
 *
 * WHY NOT `apply-snapshot.mjs`. Its truncate is CASCADE over companies, sites,
 * users and forms, which empties everything hanging off them — site locations,
 * contacts, permissions, agencies. The client wants those left alone and
 * everything else replaced.
 *
 * KEPT, NEVER TOUCHED (client's list, plus what only exists in the new app):
 *   companies · users · forms + user_form_permissions · user_sites ·
 *   user_companies · site_locations · site_contacts · agencies (+ its tables) ·
 *   document_counters · refresh_tokens
 * `sites`, `countries`, `states`, `cities` are UPSERTED, not truncated: site locations
 * hang off sites and agencies off states and cities, so a row is added or brought
 * up to date by id and never removed.
 * EVERYTHING ELSE the snapshots carry is truncated and reloaded.
 *
 * `document_counters` is kept on purpose. Emptying it restarts the PO and purchase
 * request numbering at 001 beside the legacy numbers just loaded.
 *
 * THE GUARD. A CASCADE truncate reaches every table with a foreign key to the
 * ones named. Before truncating, the FK graph is walked; if the cascade would
 * reach a KEPT table the run stops, naming it, and nothing is written. Tables the
 * cascade reaches that are not kept (payout lists, balance sheets... anything
 * that hangs off invoices or suppliers) are listed — they are emptied too.
 *
 * ONE TRANSACTION. With --dry-run everything runs and is then rolled back, so
 * the counts printed are the real ones and nothing is changed.
 */

const [MASTERS, TRANSACTIONS] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DRY_RUN = process.argv.includes("--dry-run");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL;
if (!MASTERS || !TRANSACTIONS || !PGURL) {
  console.error("Usage: node --env-file=<api .env> apply-resync.mjs <masters.json> <transactions.json> [--dry-run]");
  process.exit(1);
}

const KEEP = new Set([
  "companies",
  "users",
  "forms",
  "user_form_permissions",
  "user_sites",
  "user_companies",
  "site_locations",
  "site_contacts",
  "document_counters",
  "refresh_tokens",
]);
/** Tables of the Agency Master screen, found by name so a new one is kept too. */
const isKept = (table) => KEEP.has(table) || table === "agencies" || table.startsWith("agency_");
// Upserted by id, never truncated: site locations hang off sites, and agencies hang
// off states and cities. The legacy ids are kept, so rows line up.
const UPSERT = new Set(["sites", "countries", "states", "cities"]);

const masters = JSON.parse(readFileSync(MASTERS, "utf8"));
const transactions = JSON.parse(readFileSync(TRANSACTIONS, "utf8"));
const tablesOf = (snapshot) => Object.keys(snapshot).filter((k) => k !== "__meta");

const plan = [
  ...tablesOf(masters).map((table) => ({ table, rows: masters[table] })),
  ...tablesOf(transactions).map((table) => ({ table, rows: transactions[table] })),
];
// Client, 15 Oct 2026: payout lists and balance sheets are not wanted after a resync.
const ALSO_EMPTY = ["payout_lists", "payout_list_lines", "payout_list_invoices", "balance_sheets", "balance_sheet_rows"];
const truncateWanted = [
  ...new Set([
    ...ALSO_EMPTY,
    ...(masters.__meta?.truncate ?? []),
    ...(transactions.__meta?.truncate ?? []),
    ...plan.map((p) => p.table),
  ]),
].filter((table) => !isKept(table) && !UPSERT.has(table));

console.log(`Masters       ${MASTERS}  (${masters.__meta?.generatedAt ?? masters.__meta?.writtenAt ?? "unknown time"})`);
console.log(`Transactions  ${TRANSACTIONS}  (${transactions.__meta?.writtenAt ?? "unknown time"})`);
console.log(DRY_RUN ? "\nDRY RUN: runs fully, then rolls back.\n" : "\nLIVE RUN.\n");

class Rollback extends Error {}

const pg = postgres(PGURL, { max: 1, onnotice: () => {} });
try {
  /** Every table a CASCADE truncate of `roots` would also empty. */
  const cascadeOf = async (tx, roots) => {
    const fks = await tx`
      select child.relname as child, parent.relname as parent
      from pg_constraint c
      join pg_class child on child.oid = c.conrelid
      join pg_class parent on parent.oid = c.confrelid
      join pg_namespace n on n.oid = child.relnamespace
      where c.contype = 'f' and n.nspname = current_schema()`;
    const reached = new Set(roots);
    for (let grew = true; grew; ) {
      grew = false;
      for (const { child, parent } of fks) {
        if (reached.has(parent) && !reached.has(child)) {
          reached.add(child);
          grew = true;
        }
      }
    }
    return reached;
  };

  await pg
    .begin(async (tx) => {
      const existing = new Set((await tx`select tablename from pg_tables where schemaname = current_schema()`).map((r) => r.tablename));
      const unknown = plan.filter((p) => !existing.has(p.table)).map((p) => p.table);
      if (unknown.length > 0) throw new Error(`Tables in the snapshots that the database does not have: ${unknown.join(", ")}`);

      const roots = truncateWanted.filter((t) => existing.has(t));
      const reached = await cascadeOf(tx, roots);
      const hitKept = [...reached].filter((t) => isKept(t));
      if (hitKept.length > 0) {
        throw new Error(
          `Stopped: truncating ${roots.join(", ")} would also empty kept table(s): ${hitKept.join(", ")}. Nothing was written.`,
        );
      }
      const alsoEmptied = [...reached].filter((t) => !roots.includes(t) && !UPSERT.has(t));
      const counted = [...new Set([...reached, ...KEEP, ...plan.map((p) => p.table)])].filter((t) => existing.has(t));
      const before = {};
      for (const t of counted) before[t] = Number((await tx.unsafe(`select count(*) as n from ${t}`))[0].n);

      console.log(`Truncating (cascade) : ${roots.join(", ")}`);
      if (alsoEmptied.length > 0) {
        console.log(`Also emptied by FK   : ${alsoEmptied.map((t) => `${t} (${before[t] ?? "?"} rows)`).join(", ")}`);
      }
      await tx.unsafe(`truncate table ${roots.join(", ")} restart identity cascade`);

      console.log("\nLoading ...");
      for (const { table, rows } of plan) {
        if (isKept(table)) {
          console.log(`  ${table.padEnd(36)} ${String(rows.length).padStart(6)}  KEPT, snapshot rows ignored`);
          continue;
        }
        if (rows.length === 0) {
          console.log(`  ${table.padEnd(36)}      0`);
          continue;
        }
        const size = 500;
        for (let i = 0; i < rows.length; i += size) {
          const chunk = rows.slice(i, i + size);
          if (UPSERT.has(table)) {
            const columns = Object.keys(chunk[0]).filter((c) => c !== "id");
            await tx`insert into ${tx(table)} ${tx(chunk)} on conflict (id) do update set ${tx.unsafe(
              columns.map((c) => `"${c}" = excluded."${c}"`).join(", "),
            )}`;
          } else {
            await tx`insert into ${tx(table)} ${tx(chunk)}`;
          }
        }
        console.log(`  ${table.padEnd(36)} ${String(rows.length).padStart(6)}${UPSERT.has(table) ? "  upserted by id" : ""}`);
      }

      const reset = (masters.__meta?.resetSequences ?? ["units", "site_addresses"]).filter(
        (t) => !isKept(t) && existing.has(t) && plan.some((p) => p.table === t && p.rows.length > 0),
      );
      for (const table of reset) {
        const [{ seq }] = await tx`select pg_get_serial_sequence(${table}, 'id') as seq`;
        if (!seq) continue;
        const [{ max }] = await tx.unsafe(`select max(id) as max from ${table}`);
        await tx.unsafe(`select setval('${seq}', ${Number(max)})`);
        console.log(`  sequence ${table}: next id ${Number(max) + 1}`);
      }

      console.log("\nRow counts, before -> after:");
      for (const t of Object.keys(before).sort()) {
        const [{ n }] = await tx.unsafe(`select count(*) as n from ${t}`);
        console.log(`  ${t.padEnd(36)} ${String(before[t]).padStart(7)} -> ${String(n).padStart(7)}${isKept(t) ? "  (kept)" : ""}`);
        if (isKept(t) && Number(n) !== before[t]) throw new Error(`Kept table ${t} changed (${before[t]} -> ${n}). Rolled back.`);
      }

      if (DRY_RUN) throw new Rollback();
    })
    .catch((error) => {
      if (error instanceof Rollback) {
        console.log("\nDry run complete: rolled back, nothing changed.");
        return;
      }
      throw error;
    });
  if (!DRY_RUN) console.log("\nCommitted.");
} catch (error) {
  console.error(`\nFAILED, nothing changed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pg.end();
}
