import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";

/**
 * Site locations from the client's "InvoiceDetails" exports, and each purchase
 * invoice linked to its location (client, 19 Oct 2026). Run on the server, next to
 * the live database:
 *
 *   node --env-file=<release>/api/.env link-site-locations.mjs <locations.json> [--dry-run] [--report <file>]
 *
 * `locations.json` is one record per invoice — our number, the supplier's number,
 * company, supplier, site and the invoice's one location — made from the Excel
 * files beforehand, so the workbook is read and checked away from the database.
 *
 * THE SITE LOCATION MASTER GETS NO DUPLICATE. A name is matched to the site's live
 * locations case- and space-insensitively; only a name the site does not have yet
 * is added. Nothing is renamed or removed.
 *
 * AN INVOICE IS LINKED ONLY WHEN EVERYTHING AGREES: exactly one invoice with our
 * number in that company, and its supplier, supplier's number and site all match
 * the sheet. An invoice already linked to the SAME location is left alone; one
 * linked to a DIFFERENT location is left alone and reported — someone chose it on
 * the screen. Everything that does not fit is reported, never guessed.
 *
 * ONE TRANSACTION; with --dry-run it runs fully and is rolled back.
 */

const args = process.argv.slice(2);
const FILE = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--report");
const DRY_RUN = args.includes("--dry-run");
const REPORT = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL;
if (!FILE || !PGURL) {
  console.error("Usage: node --env-file=<api .env> link-site-locations.mjs <locations.json> [--dry-run] [--report <file>]");
  process.exit(1);
}

const key = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const records = JSON.parse(readFileSync(FILE, "utf8"));
class Rollback extends Error {}

const pg = postgres(PGURL, { max: 1, onnotice: () => {} });
const report = { created: [], linked: 0, alreadyLinked: 0, noLocationInSheet: 0, conflicts: [], problems: [] };

try {
  await pg
    .begin(async (tx) => {
      const siteNames = [...new Set(records.map((r) => r.site))];
      const siteIds = new Map();
      for (const name of siteNames) {
        const found = await tx`select id, name from sites where lower(trim(name)) = ${key(name)} and is_deleted = false`;
        if (found.length !== 1) throw new Error(`Site "${name}": ${found.length} live sites have that name. Nothing was written.`);
        siteIds.set(name, found[0].id);
      }

      // ---- 1. The location master: add only the names a site does not have. ----
      const locationId = new Map(); // `${siteId}|${key(name)}` -> id
      for (const [siteName, siteId] of siteIds) {
        const live = await tx`select id, name from site_locations where site_id = ${siteId} and is_deleted = false`;
        for (const row of live) {
          const k = `${siteId}|${key(row.name)}`;
          if (row.name.trim() === "") continue;
          if (locationId.has(k)) throw new Error(`Site "${siteName}" already holds "${row.name}" twice. Nothing was written.`);
          locationId.set(k, row.id);
        }
        const wanted = new Map();
        for (const r of records) if (r.site === siteName && r.location) wanted.set(key(r.location), r.location.trim().replace(/\s+/g, " "));
        for (const [k, name] of wanted) {
          if (locationId.has(`${siteId}|${k}`)) continue;
          const [row] = await tx`insert into site_locations (site_id, name) values (${siteId}, ${name}) returning id`;
          locationId.set(`${siteId}|${k}`, row.id);
          report.created.push(`${siteName}: ${name}`);
        }
      }

      // ---- 2. Each invoice to its location, only when everything agrees. ----
      const invoices = await tx`
        select pi.id, pi.invoice_no, pi.supplier_invoice_no, pi.site_id, pi.site_location_id,
               c.name as company, s.name as supplier
        from purchase_invoices pi
        join companies c on c.id = pi.company_id
        join suppliers s on s.id = pi.supplier_id`;
      const byNo = new Map();
      for (const inv of invoices) {
        const k = `${key(inv.company)}|${key(inv.invoice_no)}`;
        byNo.set(k, [...(byNo.get(k) ?? []), inv]);
      }

      const toLink = new Map(); // invoice id -> location id
      for (const r of records) {
        const where = `${r.file} row ${r.row} ${r.ourNo} (${r.supplier} ${r.supplierNo})`;
        if (!r.location) { report.noLocationInSheet++; continue; }
        const siteId = siteIds.get(r.site);
        let found = byNo.get(`${key(r.company)}|${key(r.ourNo)}`) ?? [];
        if (found.length === 0) { report.problems.push(`${where}: no invoice with this number in ${r.company}`); continue; }
        if (found.length > 1) {
          // THE LEGACY APP ISSUED SOME OF OUR NUMBERS TWICE. Two invoices with one number are
          // told apart by their supplier and the supplier's own number - and only if that
          // leaves exactly one.
          const exact = found.filter(
            (inv) => key(inv.supplier) === key(r.supplier) && key(inv.supplier_invoice_no) === key(r.supplierNo) && inv.site_id === siteId,
          );
          if (exact.length !== 1) {
            report.problems.push(`${where}: ${found.length} invoices have this number in ${r.company}, and ${exact.length} of them match the supplier and the supplier's number`);
            continue;
          }
          report.toldApart = (report.toldApart ?? 0) + 1;
          found = exact;
        }
        const inv = found[0];
        const why = [];
        if (key(inv.supplier) !== key(r.supplier)) why.push(`supplier is "${inv.supplier}" here`);
        if (key(inv.supplier_invoice_no) !== key(r.supplierNo)) why.push(`supplier's number is "${inv.supplier_invoice_no}" here`);
        if (inv.site_id !== siteId) why.push("its site is another one here");
        if (why.length) { report.problems.push(`${where}: ${why.join("; ")}`); continue; }
        const target = locationId.get(`${siteId}|${key(r.location)}`);
        if (inv.site_location_id === target) { report.alreadyLinked++; continue; }
        if (inv.site_location_id) {
          const [had] = await tx`select name from site_locations where id = ${inv.site_location_id}`;
          report.conflicts.push(`${where}: already linked to "${had?.name ?? "?"}", sheet says "${r.location}" - left as it is`);
          continue;
        }
        if (toLink.has(inv.id)) {
          // Two rows of the sheets came to one invoice: neither is trusted.
          report.problems.push(`${where}: another row of the sheets matched the same invoice - neither applied`);
          toLink.set(inv.id, null);
          continue;
        }
        toLink.set(inv.id, target);
      }

      for (const [id, target] of toLink) {
        if (target === null) continue;
        await tx`update purchase_invoices set site_location_id = ${target}, updated_at = now() where id = ${id} and site_location_id is null`;
        report.linked++;
      }

      console.log(`Locations added to the master : ${report.created.length}`);
      report.created.forEach((c) => console.log(`   + ${c}`));
      console.log(`Invoices linked now           : ${report.linked}`);
      console.log(`  of them, a number used twice told apart by supplier: ${report.toldApart ?? 0}`);
      console.log(`Already linked, same location : ${report.alreadyLinked}`);
      console.log(`No location in the sheet      : ${report.noLocationInSheet} (left as they are)`);
      console.log(`Linked to ANOTHER location    : ${report.conflicts.length} (left as they are)`);
      report.conflicts.slice(0, 15).forEach((c) => console.log(`   ! ${c}`));
      console.log(`Not matched, so not touched   : ${report.problems.length}`);
      report.problems.slice(0, 30).forEach((p) => console.log(`   ? ${p}`));
      if (report.problems.length > 30) console.log(`   ... and ${report.problems.length - 30} more (see the report file)`);

      if (DRY_RUN) throw new Rollback();
    })
    .catch((error) => {
      if (error instanceof Rollback) { console.log("\nDry run complete: rolled back, nothing changed."); return; }
      throw error;
    });
  if (!DRY_RUN) console.log("\nCommitted.");
  if (REPORT) writeFileSync(REPORT, JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`\nFAILED, nothing changed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pg.end();
}
