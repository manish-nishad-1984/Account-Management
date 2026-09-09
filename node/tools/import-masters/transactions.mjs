import { readFileSync, writeFileSync } from "node:fs";
import sqlserver from "mssql";
import postgres from "postgres";
import { invoiceTotal } from "../../packages/domain/dist/index.js";

/**
 * Loads the TRANSACTIONAL tables the master importer does not cover.
 *
 * `import.mjs` beside this file loads the masters, and with them purchase
 * requests, inward challans, their attachment names, inventory arrivals and the
 * document counters. What it has never loaded is the three groups here:
 *
 *   purchase_orders  + items + delivery addresses
 *   purchase_invoices + items
 *   payments          — which have no table in the source at all
 *
 * Sales invoices are deliberately absent: both sales tables in the source are
 * EMPTY. That module has never been used, so there is nothing to migrate and a
 * loader for it would be untested code guarding an empty set.
 *
 * RUN THE MASTERS FIRST. Every foreign key here points at a master row, and
 * this tool validates against the TARGET database rather than the source —
 * a supplier that exists in SQL Server but was dropped by the master import
 * (soft-deleted, or a GST collision) would otherwise fail at insert time with a
 * constraint error instead of being reported as a row that cannot be carried.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE SOURCE COLUMNS ACTUALLY MEAN
 *
 * Established by sampling real rows and reconciling them to the paisa, because
 * guessing at money is how a migration silently restates a ledger:
 *
 *   SupplierInvoiceDetails.Price          is ALREADY NET of the discount
 *   SupplierInvoiceDetails.DiscountAmount is the discount PER UNIT
 *   SupplierInvoiceDetails.GST            is charged on quantity x Price
 *   SupplierInvoiceDetails.TotalAmount    is quantity x Price + GST
 *
 * So the port's `unit_price`, which is defined as the price BEFORE discount, is
 * `Price + DiscountAmount`. Checked against four real lines spanning 18% and
 * 28% GST, discounted and not: the recomputed GST equals the stored GST
 * exactly. Reading `Price` as the pre-discount figure instead is out by the
 * discount on every discounted line, which is 1.80 on the first line tried and
 * would not have been noticed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PAYMENTS HAVE NO TABLE IN THE SOURCE
 *
 * They are rows in `SupplierInvoice` with no lines, identified by a magic
 * string in `InvoiceNo`. Two are in use — `PayOut` (522 rows) and
 * `Opening Balance` (6) — not the three the assessment expected; no `PayIn`
 * row has ever been written.
 *
 * There is a SECOND marker, `IsPayOut`, and it is useless: it is `1` on all 528
 * sentinels AND on 1,865 ordinary invoices, and null on 206 more. Only the
 * invoice number identifies a payment. That disagreement is finding §5u and it
 * is why the port has a real table.
 */

const MSSQL = {
  server: process.env.MSSQL_SERVER ?? "localhost",
  port: Number(process.env.MSSQL_PORT ?? 1433),
  database: process.env.MSSQL_DATABASE ?? "DBAccManegment",
  user: process.env.MSSQL_USER ?? "sa",
  password: process.env.MSSQL_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 300000,
};

const PGURL = process.env.PGURL;
const DRY_RUN = process.argv.includes("--dry-run");

/** `--arg <value>`, or null. */
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

/**
 * TWO WAYS TO REACH THE TARGET, and the second exists because of a real
 * obstacle rather than a preference.
 *
 * The obvious arrangement is to read SQL Server here and write straight into
 * the target PostgreSQL. That needs a route to the target — a tunnel to the
 * server's loopback port — and this environment does not have one.
 *
 * So: `--masters <file>` reads the master snapshot that `import.mjs --snapshot`
 * writes, and validates every foreign key against THAT instead of against a
 * live database. The snapshot is exactly the set of rows the masters load
 * inserts, so the check is the same check. `--snapshot <file>` then writes the
 * transformed transactional rows out as JSON, and `apply-snapshot.mjs` inserts
 * them wherever it is run — on the server itself, next to the database.
 *
 * The JSON is also reviewable before anything is written, which a direct
 * connection is not.
 */
const MASTERS_AT = argOf("--masters");
const SNAPSHOT_AT = argOf("--snapshot");
const NEEDS_PG = !MASTERS_AT;

if (!MSSQL.password || (!DRY_RUN && !SNAPSHOT_AT && !PGURL)) {
  console.error("Missing configuration:");
  if (!MSSQL.password) console.error("  MSSQL_PASSWORD=<sql server password>");
  if (!DRY_RUN && !SNAPSHOT_AT && !PGURL) console.error("  PGURL=postgres://...");
  process.exit(1);
}

const report = { notes: [], dropped: [], drift: [] };
const note = (text) => report.notes.push(text);
const drop = (what, why) => report.dropped.push({ what, why });

/** Case-insensitive column read — EF remaps several names and the live schema drifts. */
function field(row, ...names) {
  for (const name of names) {
    if (name in row) return row[name];
    const key = Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key) return row[key];
  }
  return undefined;
}

const lower = (value) => (typeof value === "string" ? value.toLowerCase() : value);
const str = (value) =>
  value === null || value === undefined ? null : String(value).replace(/\s+$/g, "").trim() || null;
const num = (value) => (value === null || value === undefined ? "0" : String(value));
const bool = (value) => value === true || value === 1 || value === "1";

/**
 * A date the target can hold, or null.
 *
 * One `SupplierInvoice.Date` in the live data is in the year 5. It is
 * representable in a timestamptz, so nothing would reject it; it would simply
 * sort to the top of every ledger for ever. Nulled and reported instead —
 * "no date" is visibly wrong, where "27 February 0005" looks like a real row.
 */
function documentDate(value, label) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    drop(label, "its date could not be read");
    return null;
  }
  if (date.getUTCFullYear() < 1990 || date.getUTCFullYear() > 2100) {
    note(`${label}: dated ${date.toISOString().slice(0, 10)}, which is not a real date — loaded with no date`);
    return null;
  }
  return date;
}

async function main() {
  console.log(`Connecting to SQL Server  ${MSSQL.server}:${MSSQL.port}/${MSSQL.database} ...`);
  const pool = await sqlserver.connect(MSSQL);
  console.log("  connected (read-only use)\n");

  const read = async (table) => {
    const { recordset } = await pool.request().query(`SELECT * FROM [dbo].[${table}]`);
    console.log(`  ${table.padEnd(24)} ${String(recordset.length).padStart(6)} rows`);
    return recordset;
  };

  console.log("Reading transactional tables ...");
  const src = {
    orders: await read("PurchaseOrder"),
    orderItems: await read("PurchaseOrderDetails"),
    orderAddresses: await read("PODeliveryAddress"),
    invoices: await read("SupplierInvoice"),
    invoiceItems: await read("SupplierInvoiceDetails"),
  };

  // ── what the target will hold ───────────────────────────────────────────
  let pg = null;
  let masters;

  if (MASTERS_AT) {
    console.log(`\nReading the master snapshot  ${MASTERS_AT} ...`);
    masters = JSON.parse(readFileSync(MASTERS_AT, "utf8"));
  } else {
    console.log("\nReading the target's masters ...");
    pg = postgres(PGURL, { max: 1, onnotice: () => {} });
    masters = {
      sites: await pg`select id from sites`,
      suppliers: await pg`select id from suppliers`,
      companies: await pg`select id from companies`,
      items: await pg`select id from items`,
      users: await pg`select id from users`,
      units: await pg`select id from units`,
      site_groups: await pg`select id, name from site_groups`,
    };
  }

  const idSet = (rows) => new Set((rows ?? []).map((r) => String(r.id).toLowerCase()));

  const target = {
    sites: idSet(masters.sites),
    suppliers: idSet(masters.suppliers),
    companies: idSet(masters.companies),
    items: idSet(masters.items),
    users: idSet(masters.users),
    units: new Set((masters.units ?? []).map((r) => Number(r.id))),
    groupsByName: new Map(
      (masters.site_groups ?? []).map((r) => [
        String(r.name).replace(/\s+/g, " ").trim().toLowerCase(),
        String(r.id),
      ]),
    ),
  };
  for (const [k, v] of Object.entries(target)) {
    console.log(`  ${k.padEnd(14)} ${String(v.size ?? 0).padStart(6)}`);
  }

  /** A master reference, or null with the row recorded as uncarryable. */
  const ref = (value, set, label, what) => {
    const id = lower(value);
    if (!id) return null;
    if (!set.has(id)) {
      drop(what, `${label} ${id} is not in the target — the master import did not carry it`);
      return undefined; // undefined means "was set, but is unusable"
    }
    return id;
  };

  /**
   * The site group, matched by NAME because that is all the source stores.
   *
   * Four group names in the live data end with a carriage return, so a document
   * whose `SiteGroup` reads "COMMUNITY HALL" can never equal the group named
   * "COMMUNITY HALL\r\n". The master importer reports that as a defect. Here
   * both sides are whitespace-normalised before comparing, which RECOVERS those
   * documents — a deliberate departure, counted below, not a silent fix.
   */
  let recoveredGroups = 0;
  const groupId = (value) => {
    const raw = str(value);
    if (!raw) return null;
    const key = raw.replace(/\s+/g, " ").trim().toLowerCase();
    const id = target.groupsByName.get(key);
    if (!id) return null;
    if (raw !== raw.replace(/\s+/g, " ").trim()) recoveredGroups += 1;
    return id;
  };

  const actor = (value) => {
    const id = lower(value);
    return id && target.users.has(id) ? id : null;
  };

  // ── purchase orders ──────────────────────────────────────────────────────
  const orderRows = [];
  const keptOrderIds = new Set();
  const orderIdByNo = new Map();

  for (const row of src.orders) {
    const id = lower(field(row, "Id"));
    const poNo = str(field(row, "POId"));
    const label = `purchase order ${poNo ?? id}`;
    if (bool(field(row, "IsDeleted"))) continue;

    const siteId = ref(field(row, "SiteId"), target.sites, "site", label);
    const supplierId = ref(field(row, "FromSupplierId"), target.suppliers, "supplier", label);
    const companyId = ref(field(row, "ToCompanyId"), target.companies, "company", label);
    if (!poNo) { drop(label, "it has no PO number, which the target requires"); continue; }
    if (siteId === undefined || !siteId) { if (siteId !== undefined) drop(label, "it has no site"); continue; }
    if (supplierId === undefined || !supplierId) { if (supplierId !== undefined) drop(label, "it has no supplier"); continue; }
    if (companyId === undefined || !companyId) { if (companyId !== undefined) drop(label, "it has no company"); continue; }

    const schedule = str(field(row, "DeliveryShedule"));
    const immediate = schedule !== null && /immediate/i.test(schedule);
    const parsed = immediate ? null : documentDate(schedule ? new Date(schedule) : null, label);

    orderRows.push({
      id,
      po_no: poNo,
      site_id: siteId,
      supplier_id: supplierId,
      company_id: companyId,
      document_date: documentDate(field(row, "Date"), label),
      site_group_id: groupId(field(row, "SiteGroup")),
      delivery_date: Number.isNaN(parsed?.getTime?.()) ? null : parsed,
      delivery_immediate: immediate,
      terms: str(field(row, "PaymentTerms")),
      description: str(field(row, "Description")),
      billing_address: str(field(row, "BillingAddress")),
      group_address: str(field(row, "GroupAddress")),
      buyers_purchase_no: str(field(row, "BuyersPurchaseNo")),
      contact_name: str(field(row, "ContactName")),
      contact_number: str(field(row, "ContactNumber")),
      other_contact_name: str(field(row, "OtherName")),
      other_contact_number: str(field(row, "OtherContact")),
      dispatch_by: str(field(row, "DispatchBy")),
      payment_terms: str(field(row, "Terms")),
      subtotal: "0",
      total_gst_amount: num(field(row, "TotalGSTAmount")),
      total_amount: num(field(row, "TotalAmount")),
      total_discount: num(field(row, "TotalDiscount")),
      is_active: field(row, "IsActive") === null ? true : bool(field(row, "IsActive")),
      is_approved: bool(field(row, "IsApproved")),
      is_deleted: false,
      created_by: actor(field(row, "CreatedBy")),
      created_at: documentDate(field(row, "CreatedOn"), label) ?? new Date(),
      updated_by: actor(field(row, "UpdatedBy")),
      updated_at: field(row, "UpdatedOn") ?? null,
      terms_template: null,
    });
    keptOrderIds.add(id);
    if (poNo) orderIdByNo.set(poNo.toLowerCase(), id);
  }

  // ── purchase order lines ─────────────────────────────────────────────────
  const orderItemRows = [];
  const orderLineNo = new Map();
  const orderSubtotal = new Map();

  for (const row of src.orderItems) {
    if (bool(field(row, "IsDeleted"))) continue;
    const orderId = lower(field(row, "PORefId"));
    if (!keptOrderIds.has(orderId)) continue;

    const unitId = Number(field(row, "UnitTypeId"));
    if (!target.units.has(unitId)) {
      drop(`a line of purchase order ${orderId}`, `unit ${unitId} is not in the target`);
      continue;
    }

    const price = num(field(row, "Price"));
    const discount = num(field(row, "Discount"));
    const quantity = num(field(row, "Quantity"));
    const next = (orderLineNo.get(orderId) ?? 0) + 1;
    orderLineNo.set(orderId, next);

    const itemId = lower(field(row, "ItemId"));
    orderItemRows.push({
      id: crypto.randomUUID(),
      purchase_order_id: orderId,
      item_id: itemId && target.items.has(itemId) ? itemId : null,
      item_name: str(field(row, "ItemName")),
      item_description: str(field(row, "ItemDescription")),
      unit_id: unitId,
      quantity,
      unit_price: price,
      gst_percent: field(row, "GSTPer") === null ? null : num(field(row, "GSTPer")),
      gst_amount: num(field(row, "GST")),
      line_total: num(field(row, "ItemTotal")),
      discount,
      line_number: next,
      created_by: actor(field(row, "CreatedBy")),
      created_at: field(row, "CreatedOn") ?? new Date(),
      updated_by: actor(field(row, "UpdatedBy")),
      updated_at: field(row, "UpdatedOn") ?? null,
    });

    const net = Number(quantity) * Number(price);
    orderSubtotal.set(orderId, (orderSubtotal.get(orderId) ?? 0) + net);
  }
  for (const order of orderRows) {
    order.subtotal = (orderSubtotal.get(order.id) ?? 0).toFixed(2);
  }

  // ── delivery addresses ───────────────────────────────────────────────────
  const addressRows = [];
  const addressLineNo = new Map();
  for (const row of src.orderAddresses) {
    if (bool(field(row, "IsDeleted"))) continue;
    const orderId = lower(field(row, "POId"));
    if (!keptOrderIds.has(orderId)) continue;

    const raw = str(field(row, "Address"));
    if (!raw) continue;

    // The source tags a GROUP address by prefixing the string "Group-". An
    // address a person typed beginning "Group-" is indistinguishable from a
    // tagged one; that ambiguity is the source's and is carried, not resolved.
    const isGroup = raw.startsWith("Group-");
    const next = (addressLineNo.get(orderId) ?? 0) + 1;
    addressLineNo.set(orderId, next);

    addressRows.push({
      id: crypto.randomUUID(),
      purchase_order_id: orderId,
      kind: isGroup ? "group" : "site",
      address: isGroup ? raw.slice("Group-".length) : raw,
      quantity: num(field(row, "Quantity")),
      line_number: next,
      created_by: null,
      created_at: new Date(),
    });
  }

  // ── invoices and payments, split by the magic invoice number ─────────────
  const SENTINELS = new Set(["payout", "opening balance"]);
  const linesByInvoice = new Map();
  for (const row of src.invoiceItems) {
    const key = lower(field(row, "RefInvoiceId"));
    if (!key) continue;
    if (!linesByInvoice.has(key)) linesByInvoice.set(key, []);
    linesByInvoice.get(key).push(row);
  }

  const invoiceRows = [];
  const invoiceItemRows = [];
  const paymentRows = [];

  for (const row of src.invoices) {
    const id = lower(field(row, "Id"));
    const invoiceNo = str(field(row, "InvoiceNo"));
    const isSentinel = invoiceNo !== null && SENTINELS.has(invoiceNo.toLowerCase());
    const label = `${isSentinel ? invoiceNo : "invoice"} ${str(field(row, "SupplierInvoiceNo")) ?? invoiceNo ?? id}`;

    const supplierId = ref(field(row, "SupplierId"), target.suppliers, "supplier", label);
    const companyId = ref(field(row, "CompanyId"), target.companies, "company", label);
    const siteId = ref(field(row, "SiteId"), target.sites, "site", label);
    if (!supplierId) { if (supplierId !== undefined) drop(label, "it has no supplier"); continue; }
    if (!companyId) { if (companyId !== undefined) drop(label, "it has no company"); continue; }
    if (siteId === undefined) continue;

    if (isSentinel) {
      paymentRows.push({
        id,
        direction: "out",
        kind: invoiceNo.toLowerCase() === "payout" ? "payment" : "opening_balance",
        party_id: supplierId,
        company_id: companyId,
        site_id: siteId,
        site_group_id: groupId(field(row, "SiteGroup")),
        payment_date: documentDate(field(row, "Date"), label),
        amount: num(field(row, "TotalAmount")),
        description: str(field(row, "Description")),
        method: null,
        reference_no: null,
        is_deleted: false,
        created_by: actor(field(row, "CreatedBy")),
        created_at: documentDate(field(row, "CreatedOn"), label) ?? new Date(),
        updated_by: actor(field(row, "UpdatedBy")),
        updated_at: field(row, "UpdatedOn") ?? null,
      });
      continue;
    }

    // A real invoice. Recompute its totals from its own lines.
    const lines = linesByInvoice.get(id) ?? [];
    const forDomain = [];
    let lineNo = 0;
    const pending = [];

    for (const line of lines) {
      const unitId = Number(field(line, "UnitTypeId"));
      if (!target.units.has(unitId)) {
        drop(`a line of ${label}`, `unit ${unitId} is not in the target`);
        continue;
      }
      const price = Number(field(line, "Price") ?? 0);
      const discount = Number(field(line, "DiscountAmount") ?? 0);
      // `Price` is already NET of the discount; the port's unit_price is the
      // price BEFORE it. See the header of this file.
      const unitPrice = (price + discount).toFixed(2);
      const quantity = num(field(line, "Quantity"));
      const gstPercent = field(line, "GSTPer") === null ? null : num(field(line, "GSTPer"));

      forDomain.push({
        unitPrice,
        quantity,
        discountPerUnit: discount.toFixed(2),
        gstPercent: gstPercent ?? "0",
      });

      lineNo += 1;
      const itemId = lower(field(line, "ItemId"));
      pending.push({
        id: crypto.randomUUID(),
        purchase_invoice_id: id,
        item_id: itemId && target.items.has(itemId) ? itemId : null,
        item_name: str(field(line, "ItemName")),
        item_description: str(field(line, "ItemDescription")),
        unit_id: unitId,
        quantity,
        unit_price: unitPrice,
        discount_per_unit: discount.toFixed(2),
        gst_percent: gstPercent,
        gst_amount: "0",
        net_amount: "0",
        line_total: "0",
        line_number: lineNo,
        created_by: actor(field(line, "CreatedBy")),
        created_at: field(line, "CreatedOn") ?? new Date(),
        updated_by: actor(field(line, "UpdatedBy")),
        updated_at: field(line, "UpdatedOn") ?? null,
      });
    }

    const charges = {
      tds: num(field(row, "TDS")),
      roundOff: num(field(row, "DiscountRoundoff")),
    };
    const totals = invoiceTotal.corrected(forDomain, charges);

    pending.forEach((item, index) => {
      const t = totals.lines[index];
      item.gst_amount = t.gstAmount;
      item.net_amount = t.netAmount;
      item.line_total = t.total;
    });
    invoiceItemRows.push(...pending);

    const stored = Number(field(row, "TotalAmount") ?? 0);
    const recomputed = Number(totals.grandTotal);
    if (Math.abs(stored - recomputed) >= 0.01) {
      report.drift.push({
        invoice: label,
        stored: stored.toFixed(2),
        recomputed: recomputed.toFixed(2),
        difference: (recomputed - stored).toFixed(2),
      });
    }

    const poNo = str(field(row, "POId"));
    invoiceRows.push({
      id,
      supplier_invoice_no: str(field(row, "SupplierInvoiceNo")),
      invoice_no: invoiceNo,
      // 99 real invoices carry no type at all. "Purchase" is what the screen
      // shows for them and what every report already treats them as.
      invoice_type: str(field(row, "InvoiceType")) ?? "Purchase",
      site_id: siteId,
      supplier_id: supplierId,
      company_id: companyId,
      purchase_order_id: poNo ? (orderIdByNo.get(poNo.toLowerCase()) ?? null) : null,
      site_group_id: groupId(field(row, "SiteGroup")),
      document_date: documentDate(field(row, "Date"), label),
      challan_no: str(field(row, "ChallanNo")),
      lr_no: str(field(row, "LRNo")),
      vehicle_no: str(field(row, "VehicleNo")),
      dispatch_by: str(field(row, "DispatchBy")),
      payment_terms: str(field(row, "PaymentTerms")),
      description: str(field(row, "Description")),
      contact_name: str(field(row, "ContactName")),
      contact_number: str(field(row, "ContactNumber")),
      shipping_address: str(field(row, "ShippingAddress")),
      group_address: str(field(row, "GroupAddress")),
      subtotal: totals.subtotal,
      total_gst_amount: totals.totalGst,
      total_discount: totals.totalDiscount,
      tds: totals.tds,
      round_off: totals.roundOff,
      total_amount: totals.grandTotal,
      payment_status: str(field(row, "PaymentStatus")),
      is_paid_out: bool(field(row, "IsPayOut")),
      is_approved: bool(field(row, "IsApproved")),
      created_by: actor(field(row, "CreatedBy")),
      created_at: documentDate(field(row, "CreatedOn"), label) ?? new Date(),
      updated_by: actor(field(row, "UpdatedBy")),
      updated_at: field(row, "UpdatedOn") ?? null,
    });
  }

  // ── report ───────────────────────────────────────────────────────────────
  const plan = [
    ["purchase_orders", orderRows],
    ["purchase_order_items", orderItemRows],
    ["purchase_order_delivery_addresses", addressRows],
    ["purchase_invoices", invoiceRows],
    ["purchase_invoice_items", invoiceItemRows],
    ["payments", paymentRows],
  ];

  console.log("\n" + "=".repeat(72));
  console.log("WHAT WOULD BE LOADED");
  console.log("=".repeat(72));
  for (const [name, rows] of plan) {
    console.log(`  ${name.padEnd(36)} ${String(rows.length).padStart(6)}`);
  }

  const byKind = paymentRows.reduce((acc, p) => ({ ...acc, [p.kind]: (acc[p.kind] ?? 0) + 1 }), {});
  console.log(`\n  payments by kind: ${JSON.stringify(byKind)}`);
  const negative = paymentRows.filter((p) => Number(p.amount) < 0);
  if (negative.length > 0) {
    note(
      `${negative.length} opening balance(s) are NEGATIVE, e.g. ${negative[0].amount} ` +
        `(${negative[0].description}). The amount keeps its sign, so the ledger reads it ` +
        `as a debit; the column comment saying amounts are always positive is wrong for these.`,
    );
  }
  if (recoveredGroups > 0) {
    note(
      `${recoveredGroups} document(s) matched a site group only after whitespace was ` +
        `normalised — in the old system they show no group at all.`,
    );
  }

  if (report.drift.length > 0) {
    const total = report.drift.reduce((s, d) => s + Number(d.difference), 0);
    console.log("\n" + "-".repeat(72));
    console.log(`RECOMPUTED TOTALS THAT DIFFER FROM THE STORED ONES — ${report.drift.length} invoices`);
    console.log("-".repeat(72));
    console.log(`  net effect on supplier balances: ${total.toFixed(2)}`);
    for (const d of report.drift.slice(0, 15)) {
      console.log(`  ${d.invoice.padEnd(40)} stored ${d.stored.padStart(12)}  ->  ${d.recomputed.padStart(12)}  (${d.difference})`);
    }
    if (report.drift.length > 15) console.log(`  ... and ${report.drift.length - 15} more`);
  } else {
    console.log("\n  Every recomputed total equals the stored one.");
  }

  if (report.notes.length > 0) {
    console.log("\n" + "-".repeat(72));
    console.log("DATA-QUALITY NOTES");
    console.log("-".repeat(72));
    for (const n of report.notes) console.log(`  - ${n}`);
  }

  if (report.dropped.length > 0) {
    console.log("\n" + "-".repeat(72));
    console.log(`ROWS THAT CANNOT BE CARRIED — ${report.dropped.length}`);
    console.log("-".repeat(72));
    const seen = new Map();
    for (const d of report.dropped) {
      const key = d.why.replace(/[0-9a-f-]{36}/gi, "<id>");
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [why, count] of [...seen].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(5)}  ${why}`);
    }
  }

  if (SNAPSHOT_AT) {
    const snapshot = Object.fromEntries(plan);
    snapshot.__meta = {
      writtenAt: new Date().toISOString(),
      source: `${MSSQL.server}:${MSSQL.port}/${MSSQL.database}`,
      order: plan.map(([name]) => name),
      truncate: [
        "purchase_invoice_items",
        "purchase_invoices",
        "purchase_order_delivery_addresses",
        "purchase_order_items",
        "purchase_orders",
        "payments",
      ],
      notes: report.notes,
      driftCount: report.drift.length,
    };
    writeFileSync(SNAPSHOT_AT, JSON.stringify(snapshot), "utf8");
    console.log(`\nSnapshot written to ${SNAPSHOT_AT}. Nothing was loaded.`);
    await pool.close();
    if (pg) await pg.end();
    return;
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing was written. Re-run without it to load.");
    await pool.close();
    if (pg) await pg.end();
    return;
  }

  // ── load ─────────────────────────────────────────────────────────────────
  console.log("\nLoading ...");
  await pg.begin(async (tx) => {
    // Child tables first, and only these six — nothing the master import owns
    // is touched, so the two tools can be run in either order after the first.
    await tx.unsafe(`
      truncate table
        purchase_invoice_items, purchase_invoices,
        purchase_order_delivery_addresses, purchase_order_items, purchase_orders,
        payments
      cascade
    `);

    for (const [table, rows] of plan) {
      if (rows.length === 0) {
        console.log(`  ${table.padEnd(36)}      0`);
        continue;
      }
      const size = 500;
      for (let i = 0; i < rows.length; i += size) {
        await tx`insert into ${tx(table)} ${tx(rows.slice(i, i + size))}`;
      }
      console.log(`  ${table.padEnd(36)} ${String(rows.length).padStart(6)}`);
    }
  });

  console.log("\nLoaded.");
  await pool.close();
  await pg.end();
}

void NEEDS_PG;

main().catch(async (error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});
