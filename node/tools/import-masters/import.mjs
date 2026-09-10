/**
 * Reads the MASTER tables from the live SQL Server and loads them into a local
 * PostgreSQL, so the new app can be exercised against real data instead of the
 * generated dev seed.
 *
 * READ-ONLY against SQL Server. Every statement it sends there is a SELECT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THINGS THIS DELIBERATELY DOES
 *
 * 1. It does NOT copy passwords. The source `User` table stores them in
 *    PLAINTEXT (finding C-1). Every imported user gets the same known dev
 *    password instead, so real credentials never leave the SQL Server. See
 *    DEV_PASSWORD below.
 *
 * 2. It imports only rows the application shows TODAY: `IsDeleted = 0`.
 *    A row where the flag IS NULL is invisible in the current app, and
 *    backfilling NULL -> false would make it appear — a visible change the
 *    business has to sign off (09-MSSQL-to-PostgreSQL-Mapping.md section 5).
 *    The NULL rows are COUNTED and REPORTED rather than silently included
 *    or silently dropped.
 *
 * 3. It reports every ORPHAN it finds and refuses to write one. The target
 *    schema has real foreign keys; the source has ~62 reference columns with
 *    none. This is the first place that gap becomes visible with real numbers.
 *
 * 4. It reads with SELECT * and matches columns case-insensitively, because EF
 *    remaps several names (Gstno -> GSTNo, Iffccode -> IFFCCode,
 *    Gstamount -> GSTAmount, IsWithGst -> IsWithGST) and the live schema may
 *    have drifted from the model besides.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 *
 *   $env:MSSQL_PASSWORD = "..."      # the SQL Server login
 *   $env:PGURL = "postgres://postgres:PASSWORD@127.0.0.1:5432/accountbook"
 *   node import.mjs --dry-run        # read and report, write NOTHING
 *   node import.mjs                  # actually load
 *
 * Optional: MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER.
 */
import sqlserver from "mssql";
import postgres from "postgres";

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * `--snapshot <file>` writes the transformed rows to JSON and stops, instead of
 * loading them into PostgreSQL. The API can seed its embedded database from that
 * file, which means real data can be seen WITHOUT a PostgreSQL server or its
 * credentials. See tools/import-masters/README.md.
 */
const SNAPSHOT_AT = (() => {
  const i = process.argv.indexOf("--snapshot");
  return i !== -1 ? process.argv[i + 1] : null;
})();

/** Every imported user gets this. Real passwords are never read or copied. */
const DEV_PASSWORD = "DevPassword1";

const MSSQL = {
  // Defaults to the LOCAL SQL Express instance (PC-8\SQLEXPRESS, static TCP 1433),
  // not production. SQL Browser is stopped on this machine, so a named instance
  // cannot be resolved — connect by port instead.
  server: process.env.MSSQL_SERVER ?? "localhost",
  port: Number(process.env.MSSQL_PORT ?? 1433),
  database: process.env.MSSQL_DATABASE ?? "DBAccManegment",
  user: process.env.MSSQL_USER ?? "sa",
  password: process.env.MSSQL_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  requestTimeout: 120000,
};

const PGURL = process.env.PGURL;

// PGURL is only needed for an actual load. --dry-run and --snapshot never touch it.
const NEEDS_PG = !DRY_RUN && !SNAPSHOT_AT;

if (!MSSQL.password || (NEEDS_PG && !PGURL)) {
  console.error("Missing configuration.\n");
  if (!MSSQL.password) console.error('  MSSQL_PASSWORD=<sql server password>');
  if (NEEDS_PG && !PGURL) console.error('  PGURL=postgres://postgres:<pw>@127.0.0.1:5432/accountbook');
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Case-insensitive column lookup. Returns the first name that is present. */
function field(row, ...names) {
  if (!row.__lower) {
    Object.defineProperty(row, "__lower", {
      value: new Map(Object.keys(row).map((k) => [k.toLowerCase(), k])),
      enumerable: false,
    });
  }
  for (const n of names) {
    const key = row.__lower.get(n.toLowerCase());
    if (key !== undefined) return row[key];
  }
  return undefined;
}

/** The source uses IsDelete and IsDeleted interchangeably. Normalise both. */
const deletedFlag = (row) => field(row, "IsDeleted", "IsDelete");

const str = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
const bool = (v) => v === true || v === 1;
const num = (v) => (v === null || v === undefined ? null : String(v));
const date = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : null);
const uuid = (v) => {
  const s = str(v);
  return s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    ? s.toLowerCase()
    : null;
};

/** Splits the CSV GUID columns (User.SiteId / User.CompanyId) into real ids. */
const csvIds = (v) =>
  str(v) === null
    ? []
    : String(v)
        .split(",")
        .map((s) => uuid(s))
        .filter(Boolean);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ── read ─────────────────────────────────────────────────────────────────────

const report = { skippedNullDeleted: {}, orphans: [], notes: [] };

/**
 * Resolves each table's SCHEMA from the catalogue instead of assuming `dbo`.
 *
 * In this database `GroupMaster` lives in `Chintandb` while everything else is
 * in `dbo`, so an unqualified name fails with "Invalid object name". That is
 * precisely the schema drift the assessment lists as Blocker 5 — so the schema
 * is looked up every run, never hardcoded.
 */
async function resolveSchemas(pool, tableNames) {
  const result = await pool.request().query(`
    SELECT s.name AS [schema], t.name AS [table]
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
  `);

  const catalogue = new Map(
    result.recordset.map((r) => [r.table.toLowerCase(), { schema: r.schema, actual: r.table }]),
  );

  const resolved = new Map();
  const missing = [];
  for (const entry of tableNames) {
    // An entry may be a single name, or a list of spellings the same table has
    // been seen under. The FIRST is canonical — it is the key everything below
    // reads by — and the rest are accepted as aliases.
    const names = Array.isArray(entry) ? entry : [entry];
    const canonical = names[0];

    const found = names.map((name) => catalogue.get(name.toLowerCase())).find(Boolean);
    if (found) {
      resolved.set(canonical, found);
      if (found.actual.toLowerCase() !== canonical.toLowerCase()) {
        report.notes.push(
          `${canonical} is spelled ${found.actual} in this database — read under that name.`,
        );
      }
    } else {
      missing.push(names.join(" / "));
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Not found in ${MSSQL.database}: ${missing.join(", ")}. ` +
        `The live schema differs from the EF model — that is itself a finding.`,
    );
  }

  const nonDbo = [...resolved].filter(([, v]) => v.schema.toLowerCase() !== "dbo");
  if (nonDbo.length > 0) {
    report.notes.push(
      `Tables outside the dbo schema: ` +
        nonDbo.map(([t, v]) => `${v.schema}.${v.actual === t ? t : v.actual}`).join(", "),
    );
  }

  return resolved;
}

async function readAll(pool, schemas, table) {
  const { schema, actual } = schemas.get(table);
  const result = await pool.request().query(`SELECT * FROM [${schema}].[${actual}]`);
  return result.recordset;
}

/** Keeps only rows the current application would show, and counts what it drops. */
function liveRows(rows, table) {
  let nullFlag = 0;
  const kept = rows.filter((r) => {
    const flag = deletedFlag(r);
    if (flag === null || flag === undefined) {
      nullFlag += 1;
      return false;
    }
    return !bool(flag);
  });
  if (nullFlag > 0) report.skippedNullDeleted[table] = nullFlag;
  return kept;
}

// ── main ─────────────────────────────────────────────────────────────────────

let pool;
let pg;

try {
  console.log(`Connecting to SQL Server  ${MSSQL.server}:${MSSQL.port}/${MSSQL.database} ...`);
  pool = await sqlserver.connect(MSSQL);
  console.log("  connected (read-only use)\n");

  const SOURCE_TABLES = [
    "UnitMaster",
    /**
     * THE ADDRESS LOOKUP TABLES, which this tool never read until now.
     *
     * Every `city_id` / `state_id` / `country_id` on companies, sites and
     * suppliers has been carried across since the first import as a bare number
     * with nothing in the target to resolve it against — so every address in the
     * application displays an integer where a place name belongs. 639 rows fix
     * that, and the census says all thirteen references resolve cleanly.
     */
    "Countries",
    "States",
    "Cities",
    "Company",
    "Site",
    /** A site's ADDITIONAL shipping addresses, offered on the order screen. */
    "SiteAddress",
    "SupplierMaster",
    "ItemMaster",
    "GroupMaster",
    "User",
    "Form",
    "UserwiseFormPermission",
    "PurchaseRequest",
    "InventoryInward",
    "ItemInword",
    // Seen under BOTH spellings. The database this tool first ran against had
    // the singular; the copy on this machine has the plural, and the tool
    // aborted on it — "Not found in DBAccManegment: ItemInWordDocument" — which
    // stopped the whole import over one letter. Drift in the live schema is
    // this tool's subject matter, so it is reported and read, not fatal.
    ["ItemInWordDocument", "ItemInWordDocuments"],
  ];
  const schemas = await resolveSchemas(pool, SOURCE_TABLES);
  for (const note of report.notes) console.log(`  note: ${note}`);

  console.log("\nReading master tables ...");
  const raw = {
    units: await readAll(pool, schemas, "UnitMaster"),
    countries: await readAll(pool, schemas, "Countries"),
    states: await readAll(pool, schemas, "States"),
    cities: await readAll(pool, schemas, "Cities"),
    companies: await readAll(pool, schemas, "Company"),
    sites: await readAll(pool, schemas, "Site"),
    siteAddresses: await readAll(pool, schemas, "SiteAddress"),
    suppliers: await readAll(pool, schemas, "SupplierMaster"),
    items: await readAll(pool, schemas, "ItemMaster"),
    groups: await readAll(pool, schemas, "GroupMaster"),
    users: await readAll(pool, schemas, "User"),
    forms: await readAll(pool, schemas, "Form"),
    permissions: await readAll(pool, schemas, "UserwiseFormPermission"),
    purchaseRequests: await readAll(pool, schemas, "PurchaseRequest"),
    inventoryInward: await readAll(pool, schemas, "InventoryInward"),
    // `ItemInword` — the entity's spelling. `resolveSchemas` matches case
    // insensitively, so `ItemInWord` would find it too; the entity name is used
    // because that is what the DbContext maps.
    inwardChallans: await readAll(pool, schemas, "ItemInword"),
    inwardDocuments: await readAll(pool, schemas, "ItemInWordDocument"),
  };
  for (const [k, v] of Object.entries(raw)) {
    console.log(`  ${k.padEnd(12)} ${String(v.length).padStart(6)} rows`);
  }

  // ── filter to what the app shows today ───────────────────────────────────
  const src = {
    units: raw.units,
    /**
     * Geography has no soft-delete column in the source, so there is nothing to
     * filter: reference data is either present or it is not.
     */
    countries: raw.countries,
    states: raw.states,
    cities: raw.cities,
    companies: liveRows(raw.companies, "Company"),
    sites: liveRows(raw.sites, "Site"),
    siteAddresses: liveRows(raw.siteAddresses, "SiteAddress"),
    suppliers: liveRows(raw.suppliers, "SupplierMaster"),
    items: liveRows(raw.items, "ItemMaster"),
    groups: raw.groups,
    users: liveRows(raw.users, "User"),
    forms: raw.forms,
    permissions: raw.permissions,
    purchaseRequests: liveRows(raw.purchaseRequests, "PurchaseRequest"),
    /**
     * `IsDeleted` on this table is never actually set: DeleteInventoryDetails
     * writes the flag and then calls Remove() on the same entity, so the row
     * leaves the table instead. `liveRows` therefore returns everything that is
     * still there, which is the correct live set anyway.
     */
    inventoryInward: liveRows(raw.inventoryInward, "InventoryInward"),
    inwardChallans: liveRows(raw.inwardChallans, "ItemInword"),
    inwardDocuments: raw.inwardDocuments,
  };

  // ── build target rows, collecting orphans ────────────────────────────────
  const unitIds = new Set(src.units.map((r) => field(r, "UnitId")));
  const siteIds = new Set(src.sites.map((r) => uuid(field(r, "SiteId"))).filter(Boolean));
  const companyIds = new Set(
    src.companies.map((r) => uuid(field(r, "CompanyId"))).filter(Boolean),
  );

  // A reference to a SOFT-DELETED row and a reference to a row that does not
  // exist at all are very different findings. The first is ordinary debris left
  // behind by a delete; the second is real referential corruption. Reporting
  // them as one number overstates the problem, so keep the deleted ids to tell
  // them apart.
  const allIds = (rows, ...names) =>
    new Set(rows.map((r) => uuid(field(r, ...names))).filter(Boolean));
  const deleted = {
    sites: new Set([...allIds(raw.sites, "SiteId")].filter((id) => !siteIds.has(id))),
    companies: new Set(
      [...allIds(raw.companies, "CompanyId")].filter((id) => !companyIds.has(id)),
    ),
    users: new Set(),
  };

  /** Records an orphan, classified by whether the target row exists at all. */
  const orphan = (relationship, id, targetId, deletedSet, describe) => {
    const kind = deletedSet.has(targetId) ? "deleted" : "missing";
    report.orphans.push({ relationship, id, kind, detail: describe(kind) });
  };

  const outUnits = src.units.map((r) => ({
    id: field(r, "UnitId"),
    name: str(field(r, "UnitName")) ?? "(unnamed)",
  }));

  const outCompanies = src.companies.map((r) => ({
    id: uuid(field(r, "CompanyId")),
    name: str(field(r, "CompanyName")) ?? "(unnamed)",
    invoice_prefix: str(field(r, "InvoicePef", "InvoicePrefix")),
    gst_no: str(field(r, "GSTNo", "Gstno")),
    pan_no: str(field(r, "PanNo")),
    address: str(field(r, "Address")),
    area: str(field(r, "Area")),
    city_id: field(r, "CityId") ?? null,
    state_id: field(r, "StateId", "State_Id") ?? null,
    country_id: field(r, "Country", "CountryId", "Country_id") ?? null,
    pincode: str(field(r, "Pincode", "PinCode")),
    bank_name: str(field(r, "BankName")),
    bank_branch: str(field(r, "BankBranch")),
    account_no: str(field(r, "AccountNo")),
    ifsc_code: str(field(r, "IFFCCode", "Iffccode")),
    is_deleted: false,
    created_by: uuid(field(r, "CreatedBy")),
    created_at: date(field(r, "CreatedOn")) ?? new Date(),
    updated_by: uuid(field(r, "UpdatedBy")),
    updated_at: date(field(r, "UpdatedOn")),
  }));

  /**
   * GEOGRAPHY. The source's own ids are kept, deliberately: 205 suppliers, 20
   * sites and 8 companies already hold those numbers, and their columns are not
   * being rewritten. `Cities.CityId` 412 has to stay 412.
   *
   * Loaded in dependency order — countries, then states, then cities — because
   * the target declares real foreign keys between them. Rows whose parent is
   * missing are dropped rather than allowed to fail the whole transaction, but
   * the live census found none: 603 cities all resolve to a state, and all 35
   * states to a country.
   */
  const outCountries = src.countries.map((r) => ({
    id: field(r, "CountryId"),
    // `char(n)` in SQL Server, so it arrives blank-padded — "IN  ", not "IN".
    code: str(field(r, "CountryCode")),
    name: str(field(r, "CountryName")) ?? "(unnamed)",
  }));

  const countryIds = new Set(outCountries.map((r) => r.id));
  const outStates = src.states
    .map((r) => ({
      id: field(r, "StatesId"),
      name: str(field(r, "StatesName")) ?? "(unnamed)",
      // The GST state code (24 = Gujarat), not a postal abbreviation.
      state_code: field(r, "StateCode") ?? null,
      country_id: field(r, "Country_id", "CountryId"),
    }))
    .filter((r) => {
      if (countryIds.has(r.country_id)) return true;
      report.orphans.push({
        relationship: "states.country_id -> countries",
        id: r.id,
        kind: "missing",
        detail: `state "${r.name}" names country ${r.country_id}, which is not in Countries`,
      });
      return false;
    });

  const stateIds = new Set(outStates.map((r) => r.id));
  const outCities = src.cities
    .map((r) => ({
      id: field(r, "CityId"),
      name: str(field(r, "CityName")) ?? "(unnamed)",
      state_id: field(r, "State_Id", "StateId"),
    }))
    .filter((r) => {
      if (stateIds.has(r.state_id)) return true;
      report.orphans.push({
        relationship: "cities.state_id -> states",
        id: r.id,
        kind: "missing",
        detail: `city "${r.name}" names state ${r.state_id}, which is not in States`,
      });
      return false;
    });

  const outSites = src.sites.map((r) => ({
    id: uuid(field(r, "SiteId")),
    name: str(field(r, "SiteName")) ?? "(unnamed)",
    // The source has NO Company->Site relationship at all. Nothing derives this,
    // so it stays null rather than being invented. See SESSION-HANDOFF section 6, choice 1.
    company_id: null,
    is_active: bool(field(r, "IsActive")),
    contact_person_name: str(field(r, "ContectPersonName", "ContactPersonName")),
    contact_person_phone_no: str(field(r, "ContectPersonPhoneNo", "ContactPersonPhoneNo")),
    address: str(field(r, "Address")),
    area: str(field(r, "Area")),
    city_id: field(r, "CityId") ?? null,
    state_id: field(r, "StateId", "State_Id") ?? null,
    country_id: field(r, "Country", "CountryId", "Country_id") ?? null,
    pincode: str(field(r, "Pincode", "PinCode")),
    shipping_address: str(field(r, "ShippingAddress")),
    shipping_area: str(field(r, "ShippingArea")),
    shipping_city_id: field(r, "ShippingCityId") ?? null,
    shipping_state_id: field(r, "ShippingStateId") ?? null,
    shipping_country_id: field(r, "ShippingCountry", "ShippingCountryId") ?? null,
    shipping_pincode: str(field(r, "ShippingPincode", "ShippingPinCode")),
    is_deleted: false,
    created_by: uuid(field(r, "CreatedBy")),
    created_at: date(field(r, "CreatedOn")) ?? new Date(),
    updated_by: uuid(field(r, "UpdatedBy")),
    updated_at: date(field(r, "UpdatedOn")),
  }));

  /**
   * A site's additional shipping addresses. `site_id` is a real foreign key in
   * the target, so an address on a soft-deleted site is dropped and reported
   * rather than allowed to fail the transaction.
   */
  const outSiteAddresses = src.siteAddresses
    .map((r) => ({
      id: field(r, "AId"),
      site_id: uuid(field(r, "SiteId")),
      address: str(field(r, "Address")) ?? "",
      is_deleted: false,
    }))
    .filter((r) => {
      if (r.site_id && siteIds.has(r.site_id)) return true;
      orphan("site_addresses.site_id -> sites", r.id, r.site_id, deleted.sites, (kind) =>
        kind === "deleted"
          ? `address ${r.id} belongs to a soft-deleted site`
          : `address ${r.id} names site ${r.site_id}, which does not exist`,
      );
      return false;
    });

  const outSuppliers = src.suppliers.map((r) => ({
    id: uuid(field(r, "SupplierId")),
    name: str(field(r, "SupplierName")) ?? "(unnamed)",
    mobile: str(field(r, "Mobile")),
    email: str(field(r, "Email")),
    gst_no: str(field(r, "GSTNo", "Gstno")),
    building_name: str(field(r, "BuildingName")),
    area: str(field(r, "Area")) ?? "",
    city_id: field(r, "City", "CityId") ?? null,
    state_id: field(r, "State", "StateId") ?? null,
    pincode: str(field(r, "PinCode", "Pincode")),
    bank_name: str(field(r, "BankName")),
    bank_branch: str(field(r, "BankBranch")),
    account_no: str(field(r, "AccountNo")),
    ifsc_code: str(field(r, "IFFCCode", "Iffccode")),
    is_approved: bool(field(r, "IsApproved")),
    opening_balance: num(field(r, "OpeningBalance")),
    opening_balance_date: date(field(r, "OpeningBalanceDate")),
    is_deleted: false,
    created_by: uuid(field(r, "CreatedBy")),
    created_at: date(field(r, "CreatedOn")) ?? new Date(),
    updated_by: uuid(field(r, "UpdatedBy")),
    updated_at: date(field(r, "UpdatedOn")),
  }));

  const outItems = [];
  for (const r of src.items) {
    const unitId = field(r, "UnitType", "UnitId");
    if (!unitIds.has(unitId)) {
      report.orphans.push({
        relationship: "ItemMaster.UnitType -> UnitMaster.UnitId",
        id: uuid(field(r, "ItemId")),
        detail: `item "${str(field(r, "ItemName"))}" points at unit ${unitId}, which does not exist`,
      });
      continue;
    }
    outItems.push({
      id: uuid(field(r, "ItemId")),
      name: str(field(r, "ItemName")) ?? "(unnamed)",
      unit_id: unitId,
      price_per_unit: num(field(r, "PricePerUnit")) ?? "0",
      is_with_gst: bool(field(r, "IsWithGST", "IsWithGst")),
      gst_percent: num(field(r, "GSTPer", "Gstper")),
      gst_amount: num(field(r, "GSTAmount", "Gstamount")),
      hsn_code: str(field(r, "HSNCode", "Hsncode")),
      is_approved: bool(field(r, "IsApproved")),
      is_deleted: false,
      created_by: uuid(field(r, "CreatedBy")),
      created_at: date(field(r, "CreatedOn")) ?? new Date(),
      updated_by: uuid(field(r, "UpdatedBy")),
      updated_at: date(field(r, "UpdatedOn")),
    });
  }

  // ── GroupMaster: one table doing three jobs, written as a cross product ──
  // One row per (site x address) pair, repeating GroupName and GroupId in each.
  // Collapse it with a DISTINCT per side. See SESSION-HANDOFF section 6.
  const groupById = new Map();
  const groupSitePairs = new Set();
  const groupAddressPairs = new Set();

  for (const r of src.groups) {
    const gid = uuid(field(r, "GroupId"));
    if (!gid) continue;
    if (!groupById.has(gid)) {
      // NOT trimmed. One group in this database is named "OFFICE" and another
      // "OFFICE\r\n" — trimming would silently merge two genuinely distinct
      // groups, which is a business decision, not an import decision. The
      // whitespace is reported below instead.
      const rawName = field(r, "GroupName");
      groupById.set(gid, {
        id: gid,
        name: rawName === null || rawName === undefined ? "(unnamed)" : String(rawName),
        is_deleted: false,
        created_by: null,
        created_at: date(field(r, "CreatedOn")) ?? new Date(),
        updated_by: null,
        updated_at: null,
      });
    }
    const sid = uuid(field(r, "SiteId"));
    if (sid) {
      if (siteIds.has(sid)) groupSitePairs.add(`${gid}|${sid}`);
      else
        orphan(
          "GroupMaster.SiteId -> Site.SiteId",
          gid,
          sid,
          deleted.sites,
          (k) => `group "${str(field(r, "GroupName"))}" references site ${sid}, which is ${k}`,
        );
    }
    const addr = str(field(r, "GroupAddress"));
    if (addr) groupAddressPairs.add(`${gid}|${addr}`);
  }

  // The target has a case-insensitive unique index on site_groups.name, because
  // PurchaseOrder.SiteGroup and SupplierInvoice.SiteGroup hold the NAME and match
  // it by string equality — the name is a de facto foreign key. So a name that
  // collides, or one carrying stray whitespace, is a real finding: documents
  // either cannot be resolved to one group, or can never match theirs at all.
  const droppedGroups = new Set();
  const seenGroupName = new Map();

  for (const g of groupById.values()) {
    if (g.name !== g.name.trim()) {
      report.notes.push(
        `site group ${g.id} is named ${JSON.stringify(g.name)} — it carries stray ` +
          `whitespace, so a document whose SiteGroup is ${JSON.stringify(g.name.trim())} ` +
          `can never match it by string equality`,
      );
    }
    const key = g.name.toLowerCase();
    if (seenGroupName.has(key)) {
      droppedGroups.add(g.id);
      report.notes.push(
        `site group ${g.id} duplicates the name ${JSON.stringify(g.name)} already used ` +
          `by ${seenGroupName.get(key)} — the target forbids this, so it was NOT imported`,
      );
    } else {
      seenGroupName.set(key, g.id);
    }
  }

  for (const id of droppedGroups) groupById.delete(id);
  for (const k of [...groupSitePairs]) {
    if (droppedGroups.has(k.split("|")[0])) groupSitePairs.delete(k);
  }
  for (const k of [...groupAddressPairs]) {
    if (droppedGroups.has(k.slice(0, k.indexOf("|")))) groupAddressPairs.delete(k);
  }

  const outGroups = [...groupById.values()];
  const outGroupSites = [...groupSitePairs].map((k) => {
    const [group_id, site_id] = k.split("|");
    return { group_id, site_id };
  });
  const outGroupAddresses = [...groupAddressPairs].map((k) => {
    const i = k.indexOf("|");
    return { group_id: k.slice(0, i), address: k.slice(i + 1) };
  });

  // ── users, and the CSV columns that become junction tables ───────────────
  const seenUserName = new Map();
  const outUsers = [];
  const outUserSites = [];
  const outUserCompanies = [];

  for (const r of src.users) {
    const id = uuid(field(r, "Id", "UserId"));
    if (!id) continue;

    // The target has a lower(user_name) unique index; the source has no such
    // constraint, so a duplicate would abort the whole load.
    const userName = str(field(r, "UserName")) ?? id;
    const key = userName.toLowerCase();
    if (seenUserName.has(key)) {
      report.orphans.push({
        relationship: "User.UserName (duplicate)",
        id,
        detail: `username "${userName}" already used by ${seenUserName.get(key)} — the target enforces uniqueness, the source does not`,
      });
      continue;
    }
    seenUserName.set(key, id);

    outUsers.push({
      id,
      first_name: str(field(r, "FirstName")) ?? "",
      last_name: str(field(r, "LastName")) ?? "",
      email: str(field(r, "Email")) ?? "",
      phone_no: str(field(r, "PhoneNo")) ?? "",
      user_name: userName,
      // NOT the real password. See the header.
      password: DEV_PASSWORD,
      password_is_legacy: true,
      password_migrated_at: null,
      is_active: bool(field(r, "IsActive")),
      is_deleted: false,
      created_by: uuid(field(r, "CreatedBy")),
      created_at: date(field(r, "CreatedOn")) ?? new Date(),
      updated_by: uuid(field(r, "UpdatedBy")),
      updated_at: date(field(r, "UpdatedOn")),
    });

    for (const sid of csvIds(field(r, "SiteId"))) {
      if (siteIds.has(sid)) outUserSites.push({ user_id: id, site_id: sid });
      else
        orphan(
          "User.SiteId (CSV) -> Site.SiteId",
          id,
          sid,
          deleted.sites,
          (k) => `user "${userName}" is assigned to site ${sid}, which is ${k}`,
        );
    }
    for (const cid of csvIds(field(r, "CompanyId"))) {
      if (companyIds.has(cid)) outUserCompanies.push({ user_id: id, company_id: cid });
      else
        orphan(
          "User.CompanyId (CSV) -> Company.CompanyId",
          id,
          cid,
          deleted.companies,
          (k) => `user "${userName}" is assigned to company ${cid}, which is ${k}`,
        );
    }
  }

  const outForms = src.forms.map((r) => ({
    id: field(r, "FormId"),
    form_group: str(field(r, "FormGroup")),
    form_name: str(field(r, "FormName")) ?? "(unnamed)",
    controller: str(field(r, "Controller")),
    action: str(field(r, "Action")),
    order_id: field(r, "OrderId") ?? null,
    is_active: bool(field(r, "IsActive")),
  }));

  const userIdSet = new Set(outUsers.map((u) => u.id));
  for (const id of allIds(raw.users, "Id", "UserId")) {
    if (!userIdSet.has(id)) deleted.users.add(id);
  }
  const formIdSet = new Set(outForms.map((f) => f.id));
  const permSeen = new Set();
  const outPermissions = [];

  for (const r of src.permissions) {
    const userId = uuid(field(r, "UserId"));
    const formId = field(r, "FormId");
    if (!userId || !userIdSet.has(userId)) {
      orphan(
        "UserwiseFormPermission.UserId -> User.Id",
        userId,
        userId,
        deleted.users,
        (k) => `permission row references user ${userId}, which is ${k}`,
      );
      continue;
    }
    if (!formIdSet.has(formId)) {
      report.orphans.push({
        relationship: "UserwiseFormPermission.FormId -> Form.FormId",
        id: userId,
        kind: "missing",
        detail: `permission row references form ${formId}, which does not exist`,
      });
      continue;
    }
    const key = `${userId}|${formId}`;
    if (permSeen.has(key)) continue; // composite PK in the target
    permSeen.add(key);

    outPermissions.push({
      user_id: userId,
      form_id: formId,
      is_view_allow: bool(field(r, "IsViewAllow")),
      is_add_allow: bool(field(r, "IsAddAllow")),
      is_edit_allow: bool(field(r, "IsEditAllow")),
      is_delete_allow: bool(field(r, "IsDeleteAllow")),
      is_approved: bool(field(r, "IsApproved")),
    });
  }

  // ── uniqueness the target enforces and the source does not ───────────────
  //
  // Seven unique indexes exist in the target. A duplicate aborts the entire
  // load, and letting ON CONFLICT DO NOTHING swallow it would leave a grid that
  // looks complete and is not. So drop the later row and SAY SO.
  //
  //   users.lower(user_name)        already handled above
  //   site_groups.lower(name)       already handled above
  //   companies.upper(gst_no)
  //   suppliers.upper(gst_no)
  //   suppliers.lower(name)
  //   items.lower(name)
  //   units.lower(name)
  const enforceUnique = (rows, index, keyOf, nameOf) => {
    const seen = new Map();
    const kept = [];
    const dropped = [];
    for (const r of rows) {
      const key = keyOf(r);
      if (key === null || key === undefined || key === "") {
        kept.push(r);
        continue;
      }
      if (seen.has(key)) {
        dropped.push(r);
        report.notes.push(
          `${index}: ${JSON.stringify(nameOf(r))} collides with ` +
            `${JSON.stringify(nameOf(seen.get(key)))} on ${JSON.stringify(key)} ` +
            `— NOT imported, the target forbids the duplicate`,
        );
        continue;
      }
      seen.set(key, r);
      kept.push(r);
    }
    return { kept, dropped, seen };
  };

  // ── purchase requests ────────────────────────────────────────────────────
  // The first TRANSACTION table. Masters above are referenced by it, so it is
  // built last and loaded last.
  const itemIds = new Set(src.items.map((r) => uuid(field(r, "ItemId"))).filter(Boolean));
  const deletedItems = new Set(
    [...allIds(raw.items, "ItemId")].filter((id) => !itemIds.has(id)),
  );
  const deletedSites = deleted.sites;

  // Suppliers, for the inward challans below. `supplier_id` is nullable there, so
  // a missing supplier clears the reference rather than dropping the document.
  const supplierIds = new Set(src.suppliers.map((r) => uuid(field(r, "SupplierId"))).filter(Boolean));
  const deletedSuppliers = new Set(
    [...allIds(raw.suppliers, "SupplierId")].filter((id) => !supplierIds.has(id)),
  );

  const outPurchaseRequests = [];
  for (const r of src.purchaseRequests) {
    const id = uuid(field(r, "Pid"));
    const siteId = uuid(field(r, "SiteId"));
    const itemId = uuid(field(r, "ItemId"));
    const unitId = field(r, "UnitTypeId");
    const prNo = str(field(r, "PrNo"));

    // site_id is NOT NULL with a real foreign key: a request whose site is gone
    // cannot be written at all, so it is reported and skipped rather than
    // silently attached to something else.
    if (!siteId || !siteIds.has(siteId)) {
      orphan("PurchaseRequest.SiteId -> Site.SiteId", id, siteId, deletedSites, (kind) =>
        `purchase request ${prNo ?? id} references site ${siteId}, which is ${kind === "deleted" ? "deleted" : "absent"}`,
      );
      continue;
    }

    // unit_id is NOT NULL too. A unit that no longer exists is unrecoverable.
    if (unitId === null || unitId === undefined || !unitIds.has(unitId)) {
      report.orphans.push({
        relationship: "PurchaseRequest.UnitTypeId -> UnitMaster.UnitId",
        id,
        kind: "missing",
        detail: `purchase request ${prNo ?? id} references unit ${unitId}, which does not exist`,
      });
      continue;
    }

    // item_id is NULLABLE by design — the request keeps its free-text ItemName
    // instead. So a missing item is reported and the reference dropped, NOT the
    // whole request: the document still says what was wanted.
    let keptItemId = itemId;
    if (itemId && !itemIds.has(itemId)) {
      orphan("PurchaseRequest.ItemId -> ItemMaster.ItemId", id, itemId, deletedItems, (kind) =>
        `purchase request ${prNo ?? id} references item ${itemId}, which is ${kind === "deleted" ? "deleted" : "absent"} — kept, with the item reference cleared`,
      );
      keptItemId = null;
    }

    outPurchaseRequests.push({
      id,
      pr_no: prNo ?? "(unnumbered)",
      site_id: siteId,
      item_id: keptItemId,
      item_name: str(field(r, "ItemName")),
      item_description: str(field(r, "ItemDescription")),
      unit_id: unitId,
      quantity: num(field(r, "Quantity")) ?? "0",
      document_date: date(field(r, "Date")),
      site_address_id: field(r, "SiteAddressId") ?? null,
      site_address: str(field(r, "SiteAddress")),
      is_approved: bool(field(r, "IsApproved")),
      is_deleted: false,
      created_by: uuid(field(r, "CreatedBy")),
      created_at: date(field(r, "CreatedOn")) ?? new Date(),
      updated_by: uuid(field(r, "UpdatedBy")),
      updated_at: date(field(r, "UpdatedOn")),
    });
  }

  // ── inventory inward ─────────────────────────────────────────────────────
  // item_id and unit_id are NOT NULL with real foreign keys, so a row whose
  // item or unit is gone cannot be written. site_id is nullable and, in this
  // table, ALWAYS NULL: nothing in the .NET application ever writes it.
  const outInventoryInward = [];
  let inventorySiteCount = 0;

  for (const r of src.inventoryInward) {
    const id = uuid(field(r, "Id"));
    const itemId = uuid(field(r, "ItemId"));
    const unitId = field(r, "UnitTypeId");
    const label = str(field(r, "Item")) ?? id;

    if (!itemId || !itemIds.has(itemId)) {
      orphan("InventoryInward.ItemId -> ItemMaster.ItemId", id, itemId, deletedItems, (kind) =>
        `inventory arrival ${label} references item ${itemId}, which is ${kind === "deleted" ? "deleted" : "absent"}`,
      );
      continue;
    }

    if (unitId === null || unitId === undefined || !unitIds.has(unitId)) {
      report.orphans.push({
        relationship: "InventoryInward.UnitTypeId -> UnitMaster.UnitId",
        id,
        kind: "missing",
        detail: `inventory arrival ${label} references unit ${unitId}, which does not exist`,
      });
      continue;
    }

    // A site that is present but gone from `sites` is cleared rather than
    // refused: the column is nullable and most rows have none anyway.
    let siteId = uuid(field(r, "SiteId"));
    if (siteId && !siteIds.has(siteId)) {
      orphan("InventoryInward.SiteId -> Site.SiteId", id, siteId, deletedSites, (kind) =>
        `inventory arrival ${label} references site ${siteId}, which is ${kind === "deleted" ? "deleted" : "absent"} — kept, with the site reference cleared`,
      );
      siteId = null;
    }
    if (siteId) inventorySiteCount += 1;

    outInventoryInward.push({
      id,
      site_id: siteId,
      item_id: itemId,
      item_name: str(field(r, "Item")),
      unit_id: unitId,
      quantity: num(field(r, "Quantity")) ?? "0",
      document_date: date(field(r, "Date")),
      details: str(field(r, "Details")),
      is_approved: bool(field(r, "IsApproved")),
      is_deleted: false,
      created_by: uuid(field(r, "CreatedBy")),
      created_at: date(field(r, "CreatedOn")) ?? new Date(),
      updated_by: uuid(field(r, "UpdatedBy")),
      updated_at: date(field(r, "UpdatedOn")),
    });
  }

  /**
   * Stated rather than assumed. The screen shows a notice while unallocated
   * rows exist, and this is where the number it will report comes from — if it
   * is not equal to the row count, something DOES write SiteId and the reading
   * of the source is wrong.
   */
  report.notes.push(
    `InventoryInward: ${outInventoryInward.length - inventorySiteCount} of ${outInventoryInward.length} arrivals have no site — the .NET create form has no site field`,
  );

  // ── inward challans ──────────────────────────────────────────────────────
  // site_id, item_id and unit_id are all NOT NULL with real foreign keys, so a
  // row missing any of them cannot be written. supplier_id is nullable — the
  // source's registered create path never writes it — so a missing supplier is
  // reported and cleared, never a reason to drop the challan.
  const outInwardChallans = [];
  const keptChallanIds = new Set();
  let challanSupplierCount = 0;

  for (const r of src.inwardChallans) {
    const id = uuid(field(r, "InwordId"));
    const siteId = uuid(field(r, "SiteId"));
    const itemId = uuid(field(r, "ItemId"));
    const unitId = field(r, "UnitTypeId");
    const label = str(field(r, "Item")) ?? id;

    if (!siteId || !siteIds.has(siteId)) {
      orphan("ItemInword.SiteId -> Site.SiteId", id, siteId, deletedSites, (kind) =>
        `inward challan ${label} references site ${siteId}, which is ${kind === "deleted" ? "deleted" : "absent"}`,
      );
      continue;
    }

    if (!itemId || !itemIds.has(itemId)) {
      orphan("ItemInword.ItemId -> ItemMaster.ItemId", id, itemId, deletedItems, (kind) =>
        `inward challan ${label} references item ${itemId}, which is ${kind === "deleted" ? "deleted" : "absent"}`,
      );
      continue;
    }

    if (unitId === null || unitId === undefined || !unitIds.has(unitId)) {
      report.orphans.push({
        relationship: "ItemInword.UnitTypeId -> UnitMaster.UnitId",
        id,
        kind: "missing",
        detail: `inward challan ${label} references unit ${unitId}, which does not exist`,
      });
      continue;
    }

    let supplierId = uuid(field(r, "SupplierId"));
    if (supplierId && !supplierIds.has(supplierId)) {
      orphan("ItemInword.SupplierId -> SupplierMaster.SupplierId", id, supplierId, deletedSuppliers, (kind) =>
        `inward challan ${label} references supplier ${supplierId}, which is ${kind === "deleted" ? "deleted" : "absent"} — kept, with the supplier reference cleared`,
      );
      supplierId = null;
    }
    if (supplierId) challanSupplierCount += 1;

    keptChallanIds.add(id);
    outInwardChallans.push({
      id,
      site_id: siteId,
      item_id: itemId,
      item_name: str(field(r, "Item")),
      supplier_id: supplierId,
      unit_id: unitId,
      quantity: num(field(r, "Quantity")) ?? "0",
      invoice_no: str(field(r, "InvoiceNo")),
      document_date: date(field(r, "Date")),
      vehicle_number: str(field(r, "VehicleNumber")),
      receiver_name: str(field(r, "ReceiverName")),
      is_approved: bool(field(r, "IsApproved")),
      is_deleted: false,
      created_by: uuid(field(r, "CreatedBy")),
      created_at: date(field(r, "CreatedOn")) ?? new Date(),
      updated_by: uuid(field(r, "UpdatedBy")),
      updated_at: date(field(r, "UpdatedOn")),
    });
  }

  report.notes.push(
    `ItemInword: ${outInwardChallans.length - challanSupplierCount} of ${outInwardChallans.length} challans have no supplier — AddItemInWordDetails never writes SupplierId`,
  );

  /**
   * Attachments. The source keeps these TWICE — a semicolon-joined string on
   * `ItemInword.DocumentName` and one row per file in `ItemInWordDocument` —
   * and reconciles them by hand. Only the child rows are carried, and the parent
   * string is exploded to fill any gap the child table has, so a file recorded in
   * one place and not the other is not lost.
   */
  const outInwardDocuments = [];
  const documentsByChallan = new Map();
  for (const r of src.inwardDocuments) {
    const challanId = uuid(field(r, "RefInWordId"));
    const name = str(field(r, "DocumentName"));
    if (!challanId || !keptChallanIds.has(challanId) || !name) continue;
    if (!documentsByChallan.has(challanId)) documentsByChallan.set(challanId, new Set());
    if (documentsByChallan.get(challanId).has(name)) continue;
    documentsByChallan.get(challanId).add(name);
    outInwardDocuments.push({ challan_id: challanId, document_name: name, storage_key: null });
  }

  let explodedFromParent = 0;
  for (const r of src.inwardChallans) {
    const challanId = uuid(field(r, "InwordId"));
    if (!challanId || !keptChallanIds.has(challanId)) continue;
    const joined = str(field(r, "DocumentName"));
    if (!joined) continue;
    for (const name of joined.split(";").map((s) => s.trim()).filter(Boolean)) {
      if (!documentsByChallan.has(challanId)) documentsByChallan.set(challanId, new Set());
      if (documentsByChallan.get(challanId).has(name)) continue;
      documentsByChallan.get(challanId).add(name);
      outInwardDocuments.push({ challan_id: challanId, document_name: name, storage_key: null });
      explodedFromParent += 1;
    }
  }
  if (explodedFromParent > 0) {
    report.notes.push(
      `ItemInword: ${explodedFromParent} attachment name(s) existed only in the parent's semicolon-joined DocumentName column, not in ItemInWordDocument`,
    );
  }
  report.notes.push(
    `ItemInword: ${outInwardDocuments.length} attachment name(s) carried. The FILES themselves are on the old web server and are not migrated by this tool.`,
  );

  const upperOrNull = (v) => (v === null || v === undefined ? null : String(v).toUpperCase().trim());
  const lowerOrNull = (v) => (v === null || v === undefined ? null : String(v).toLowerCase().trim());

  // Units first: items reference them, so a dropped unit must not orphan items.
  // Two units with the same name ARE the same unit, so remap rather than lose
  // the items.
  const unitsUnique = enforceUnique(
    outUnits,
    "units_name_lower_key",
    (r) => lowerOrNull(r.name),
    (r) => r.name,
  );
  const unitRemap = new Map();
  for (const d of unitsUnique.dropped) {
    const winner = unitsUnique.seen.get(lowerOrNull(d.name));
    if (winner) unitRemap.set(d.id, winner.id);
  }
  const finalUnits = unitsUnique.kept;

  // finalItems is derived from itemsUnique below, so that purchase requests can
  // be remapped onto the SAME winner this keeps. Deduplicating twice invites the
  // two passes to disagree, which would leave requests pointing at a dropped item.

  const finalCompanies = enforceUnique(
    outCompanies,
    "companies_gst_no_key",
    (r) => upperOrNull(r.gst_no),
    (r) => r.name,
  ).kept;

  /**
   * SUPPLIERS ARE NO LONGER DEDUPLICATED BY GST NUMBER, and the reason is that
   * the constraint behind it was wrong.
   *
   * `suppliers_gst_no_key` used to be UNIQUE — a rule this port invented, which
   * SQL Server does not have. Against the client's live data it dropped 11
   * suppliers, and with them 34 invoices worth Rs 46.4 lakh and 15 payments
   * worth Rs 29.8 lakh. Migration 0013 makes the index non-unique because at
   * least one of the collisions is legitimate: UltraTech Cement is recorded as
   * three supplier rows on one GST number, one per site and product, which is
   * how the business actually buys cement. (The others are a placeholder `00`
   * on four suppliers, and one GST number copy-pasted across five unrelated
   * names — real data-entry debris, but not this tool's to merge away.)
   *
   * Names are still deduplicated. That constraint holds in the live data, and
   * suppliers are chosen from a name dropdown where two identical entries are
   * unusable.
   */
  const suppliersByName = enforceUnique(
    outSuppliers,
    "suppliers_name_lower_key",
    (r) => lowerOrNull(r.name),
    (r) => r.name,
  );
  const finalSuppliers = suppliersByName.kept;

  const supplierRemap = new Map();
  for (const d of suppliersByName.dropped) {
    const winner = suppliersByName.seen.get(lowerOrNull(d.name));
    if (winner) supplierRemap.set(d.id, winner.id);
  }

  // Purchase requests follow their masters: a unit or item that was merged away
  // must not orphan the request that points at it.
  const itemsUnique = enforceUnique(
    outItems.map((it) => (unitRemap.has(it.unit_id) ? { ...it, unit_id: unitRemap.get(it.unit_id) } : it)),
    "items_name_lower_key",
    (r) => lowerOrNull(r.name),
    (r) => r.name,
  );
  const finalItems = itemsUnique.kept;

  const itemRemap = new Map();
  for (const d of itemsUnique.dropped) {
    const winner = itemsUnique.seen.get(lowerOrNull(d.name));
    if (winner) itemRemap.set(d.id, winner.id);
  }

  let finalPurchaseRequests = outPurchaseRequests.map((pr) => ({
    ...pr,
    unit_id: unitRemap.has(pr.unit_id) ? unitRemap.get(pr.unit_id) : pr.unit_id,
    item_id: pr.item_id && itemRemap.has(pr.item_id) ? itemRemap.get(pr.item_id) : pr.item_id,
  }));

  // The source has no unique index on PrNo, and CheckPRNo() reissues a number
  // every eleventh request of a year (it parses the sequence with
  // Substring(11), which reads ONE character). So duplicates are expected here,
  // and each one named is a document that exists twice in the old system.
  const finalInventoryInward = outInventoryInward.map((row) => ({
    ...row,
    unit_id: unitRemap.has(row.unit_id) ? unitRemap.get(row.unit_id) : row.unit_id,
    item_id: itemRemap.has(row.item_id) ? itemRemap.get(row.item_id) : row.item_id,
  }));

  const finalInwardChallans = outInwardChallans.map((row) => ({
    ...row,
    unit_id: unitRemap.has(row.unit_id) ? unitRemap.get(row.unit_id) : row.unit_id,
    item_id: itemRemap.has(row.item_id) ? itemRemap.get(row.item_id) : row.item_id,
    supplier_id:
      row.supplier_id && supplierRemap.has(row.supplier_id)
        ? supplierRemap.get(row.supplier_id)
        : row.supplier_id,
  }));

  finalPurchaseRequests = enforceUnique(
    finalPurchaseRequests,
    "purchase_requests_pr_no_key",
    (r) => upperOrNull(r.pr_no),
    (r) => r.pr_no,
  ).kept;

  // Seed the counters so the new system cannot reissue a number the old one
  // used. Without this the first request created after go-live is /001 again.
  const counters = new Map();
  for (const pr of finalPurchaseRequests) {
    const match = /^PR\/(\d{2}-\d{2})\/(\d+)$/.exec(pr.pr_no ?? "");
    if (!match) continue;
    const [, year, sequence] = match;
    const highest = Math.max(counters.get(year) ?? 0, Number(sequence));
    counters.set(year, highest);
  }
  const outDocumentCounters = [...counters].map(([financial_year, highest]) => ({
    document_type: "purchase_request",
    financial_year,
    next_value: highest + 1,
    updated_at: new Date(),
  }));
  for (const c of outDocumentCounters) {
    report.notes.push(
      `purchase request numbering for ${c.financial_year} resumes at ${String(c.next_value).padStart(3, "0")}`,
    );
  }

  // Anything referencing a company that just went must go with it.
  const keptCompanyIds = new Set(finalCompanies.map((c) => c.id));
  const finalUserCompanies = outUserCompanies.filter((uc) => keptCompanyIds.has(uc.company_id));

  // ── report ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("WHAT WOULD BE LOADED");
  console.log("=".repeat(72));
  /**
   * What to clear before loading, children first.
   *
   * Defined ONCE, because it is used twice — here when this tool writes straight
   * into PostgreSQL, and inside the snapshot so `apply-snapshot.mjs` clears
   * exactly the same set when the write happens on another machine. It used to
   * be written out in both places and the copies drifted.
   *
   * `refresh_tokens` is named rather than left to CASCADE: it references users,
   * and clearing it is correct — every session is invalidated when the user rows
   * are replaced — but it should be visible, not a surprise.
   */
  const TRUNCATE_ORDER = [
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
    "site_addresses",
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

  const plan = [
    ["units", finalUnits],
    // Geography first: states reference countries and cities reference states.
    ["countries", outCountries],
    ["states", outStates],
    ["cities", outCities],
    ["companies", finalCompanies],
    ["sites", outSites],
    ["site_addresses", outSiteAddresses],
    ["suppliers", finalSuppliers],
    ["items", finalItems],
    ["site_groups", outGroups],
    ["site_group_sites", outGroupSites],
    ["site_group_addresses", outGroupAddresses],
    ["users", outUsers],
    ["user_sites", outUserSites],
    ["user_companies", finalUserCompanies],
    ["forms", outForms],
    ["user_form_permissions", outPermissions],
    ["purchase_requests", finalPurchaseRequests],
    ["inventory_inward", finalInventoryInward],
    ["inward_challans", finalInwardChallans],
    ["inward_challan_documents", outInwardDocuments],
    ["document_counters", outDocumentCounters],
  ];
  for (const [name, rows] of plan) {
    console.log(`  ${name.padEnd(24)} ${String(rows.length).padStart(6)}`);
  }

  if (report.notes.length > 0) {
    console.log("\n" + "-".repeat(72));
    console.log("DATA-QUALITY NOTES");
    console.log("-".repeat(72));
    for (const n of report.notes) console.log(`  - ${n}`);
  }

  if (Object.keys(report.skippedNullDeleted).length > 0) {
    console.log("\n" + "-".repeat(72));
    console.log("ROWS WITH IsDeleted = NULL — skipped, and invisible in the app today");
    console.log("-".repeat(72));
    for (const [table, n] of Object.entries(report.skippedNullDeleted)) {
      console.log(`  ${table.padEnd(24)} ${String(n).padStart(6)}`);
    }
    console.log("\n  Backfilling these to false would make them APPEAR to users.");
    console.log("  That needs business sign-off — see 09-MSSQL-to-PostgreSQL-Mapping.md section 5.");
  }

  if (report.orphans.length > 0) {
    const missing = report.orphans.filter((o) => o.kind === "missing");
    const debris = report.orphans.filter((o) => o.kind === "deleted");

    const show = (title, list, closing) => {
      if (list.length === 0) return;
      const byRel = new Map();
      for (const o of list) {
        if (!byRel.has(o.relationship)) byRel.set(o.relationship, []);
        byRel.get(o.relationship).push(o);
      }
      console.log(`\n${title}`);
      for (const [rel, rows] of byRel) {
        console.log(`\n  ${rel}  (${rows.length})`);
        for (const o of rows.slice(0, 4)) console.log(`     - ${o.detail}`);
        if (rows.length > 4) console.log(`     ... and ${rows.length - 4} more`);
      }
      console.log(`\n  ${closing}`);
    };

    console.log("\n" + "=".repeat(72));
    console.log(
      `REFERENCES THAT WOULD FAIL A FOREIGN KEY — ${plural(report.orphans.length, "row", "rows")}`,
    );
    console.log("=".repeat(72));
    console.log(`  pointing at a row that DOES NOT EXIST : ${missing.length}   <- real corruption`);
    console.log(`  pointing at a SOFT-DELETED row        : ${debris.length}   <- ordinary debris`);

    show(
      "!".repeat(72) + "\nREAL CORRUPTION — the referenced row is not in the table at all",
      missing,
      "Each of these is genuine remediation work before a foreign key can exist.",
    );

    show(
      "-".repeat(72) + "\nDEBRIS — the referenced row exists but is soft-deleted",
      debris,
      "Expected: rows left behind by a soft delete. Not imported, and not a\n" +
        "  data-integrity problem — but they show what a hard delete would have to clean up.",
    );
  } else {
    console.log("\n  No orphans found in the master tables.");
  }

  if (SNAPSHOT_AT) {
    const { writeFileSync } = await import("node:fs");
    const snapshot = Object.fromEntries(plan);
    snapshot.__meta = {
      kind: "masters",
      generatedAt: new Date().toISOString(),
      source: `${MSSQL.server}:${MSSQL.port}/${MSSQL.database}`,
      devPassword: DEV_PASSWORD,
      // Carried so the applier clears exactly what a direct load would, rather
      // than relying on its own copy of this list.
      truncate: TRUNCATE_ORDER,
      // Tables whose ids the ETL supplies explicitly into an identity column.
      // `truncate ... restart identity` puts each sequence back to 1, so without
      // this the app's next insert collides with an imported row.
      resetSequences: ["units", "forms", "site_addresses"],
      skippedNullDeleted: report.skippedNullDeleted,
      orphanCount: report.orphans.length,
    };
    writeFileSync(SNAPSHOT_AT, JSON.stringify(snapshot, null, 0), "utf8");
    const { statSync } = await import("node:fs");
    const kb = Math.round(statSync(SNAPSHOT_AT).size / 1024);
    console.log(`\nSnapshot written: ${SNAPSHOT_AT} (${kb} KB)`);
    console.log("Nothing was loaded into PostgreSQL.");
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing was written. Re-run without it to load.");
    process.exit(0);
  }

  // ── load ─────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("LOADING INTO POSTGRESQL");
  console.log("=".repeat(72));

  pg = postgres(PGURL, { max: 1, onnotice: () => {} });

  await pg.begin(async (tx) => {
    await tx.unsafe(`truncate table ${TRUNCATE_ORDER.join(", ")} restart identity cascade`);

    const insert = async (table, rows) => {
      if (rows.length === 0) {
        console.log(`  ${table.padEnd(24)}      0`);
        return;
      }
      // chunked so a wide table cannot exceed the parameter limit
      const size = 500;
      for (let i = 0; i < rows.length; i += size) {
        await tx`insert into ${tx(table)} ${tx(rows.slice(i, i + size))}`;
      }
      console.log(`  ${table.padEnd(24)} ${String(rows.length).padStart(6)}`);
    };

    for (const [name, rows] of plan) await insert(name, rows);

    // units.id is an identity column and we supplied explicit ids, so the
    // sequence is still at 1 and the next insert from the app would collide.
    if (outUnits.length > 0) {
      await tx.unsafe(
        `select setval(pg_get_serial_sequence('units','id'), (select max(id) from units))`,
      );
    }
    if (outForms.length > 0) {
      const seq = await tx.unsafe(`select pg_get_serial_sequence('forms','id') as s`);
      if (seq[0]?.s) {
        await tx.unsafe(`select setval('${seq[0].s}', (select max(id) from forms))`);
      }
    }
    // Same reason: `site_addresses.id` is generated by default and the ETL
    // supplied the source's own `AId`, so the sequence would hand out 1 next.
    if (outSiteAddresses.length > 0) {
      const seq = await tx.unsafe(`select pg_get_serial_sequence('site_addresses','id') as s`);
      if (seq[0]?.s) {
        await tx.unsafe(`select setval('${seq[0].s}', (select max(id) from site_addresses))`);
      }
    }
  });

  console.log("\nDone. Point the API at it:");
  console.log(`  $env:DATABASE_URL = "${PGURL.replace(/:\/\/([^:]+):[^@]*@/, "://$1:***@")}"`);
  console.log("  then start the API as usual.");
  console.log(`\nSign in as any imported user with the password: ${DEV_PASSWORD}`);
} catch (error) {
  console.error("\nFailed:", error.message);
  if (error.originalError) console.error("  cause:", error.originalError.message);
  process.exitCode = 1;
} finally {
  if (pool) await pool.close();
  if (pg) await pg.end();
}
