import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Migration 0019 converts LIVE data — 35 site groups, the documents that name
 * them, and every site's contact — so its data half is tested against a database
 * that holds data from before it, rather than against an empty one where every
 * INSERT ... SELECT trivially selects nothing.
 *
 * The database is built by applying migrations 0000-0018, inserting a small
 * picture of the old world, and only then applying 0019.
 */

const MIGRATIONS_DIR = join(__dirname, "../../drizzle");
const TARGET = "0019_site_contacts_and_locations";

function statementsFor(tags: string[]): string[] {
  return tags.flatMap((tag) =>
    readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean),
  );
}

const SITE_A = "00000000-0000-4000-8000-00000000000a";
const SITE_B = "00000000-0000-4000-8000-00000000000b";
const SITE_C = "00000000-0000-4000-8000-00000000000c";
const GROUP_SHARED = "00000000-0000-4000-8000-0000000000a1";
const GROUP_DELETED = "00000000-0000-4000-8000-0000000000a2";
const COMPANY = "00000000-0000-4000-8000-0000000000c1";
const SUPPLIER = "00000000-0000-4000-8000-0000000000d1";
const PAY_MEMBER = "00000000-0000-4000-8000-0000000000e1";
const PAY_OUTSIDER = "00000000-0000-4000-8000-0000000000e2";
const PAY_DELETED = "00000000-0000-4000-8000-0000000000e3";

describe("migration 0019 — site groups become site locations", () => {
  let db: PGlite;

  const rows = async <T>(query: string): Promise<T[]> => (await db.query<T>(query)).rows;

  beforeAll(async () => {
    db = await PGlite.create();
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const tags = [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.tag);
    expect(tags).toContain(TARGET);
    const before = tags.slice(0, tags.indexOf(TARGET));

    for (const statement of statementsFor(before)) await db.exec(statement);

    await db.exec(`
      insert into sites (id, name, contact_person_name, contact_person_phone_no) values
        ('${SITE_A}', 'Site A', 'Ramesh', '9824000001'),
        ('${SITE_B}', 'Site B', null, '9824000002'),
        ('${SITE_C}', 'Site C', '  ', null);

      -- "Riverside\\r" as the live data has it: a trailing carriage return.
      insert into site_groups (id, name) values ('${GROUP_SHARED}', E'Riverside\\r');
      insert into site_groups (id, name, is_deleted) values ('${GROUP_DELETED}', 'Old Yard', true);
      insert into site_group_sites (group_id, site_id) values
        ('${GROUP_SHARED}', '${SITE_A}'), ('${GROUP_SHARED}', '${SITE_B}');
      insert into site_group_addresses (group_id, address) values
        ('${GROUP_SHARED}', 'Gate 1, Riverside'), ('${GROUP_SHARED}', 'Gate 2, Riverside');

      insert into companies (id, name) values ('${COMPANY}', 'Company');
      insert into suppliers (id, name) values ('${SUPPLIER}', 'Supplier');
      insert into payments (id, direction, party_id, company_id, amount, site_id, site_group_id) values
        ('${PAY_MEMBER}',   'out', '${SUPPLIER}', '${COMPANY}', '10.00', '${SITE_B}', '${GROUP_SHARED}'),
        ('${PAY_OUTSIDER}', 'out', '${SUPPLIER}', '${COMPANY}', '20.00', '${SITE_C}', '${GROUP_SHARED}'),
        ('${PAY_DELETED}',  'out', '${SUPPLIER}', '${COMPANY}', '30.00', '${SITE_A}', '${GROUP_DELETED}');
    `);

    for (const statement of statementsFor([TARGET])) await db.exec(statement);
  });

  it("gives each site its existing contact as the first of its list, and skips a blank one", async () => {
    const contacts = await rows<{ site_id: string; name: string | null; phone: string | null; line_number: number }>(
      "select site_id, name, phone, line_number from site_contacts order by site_id",
    );
    expect(contacts).toEqual([
      { site_id: SITE_A, name: "Ramesh", phone: "9824000001", line_number: 1 },
      { site_id: SITE_B, name: null, phone: "9824000002", line_number: 1 },
    ]);
  });

  it("makes one location per member site, named after the group without its carriage return", async () => {
    const locations = await rows<{ site_id: string; name: string; is_deleted: boolean }>(
      "select site_id, name, is_deleted from site_locations where not is_deleted order by site_id, name",
    );
    expect(locations).toEqual([
      { site_id: SITE_A, name: "Riverside", is_deleted: false },
      { site_id: SITE_B, name: "Riverside", is_deleted: false },
      // Site C was never a member, but a payment there named the group.
      { site_id: SITE_C, name: "Riverside", is_deleted: false },
    ]);
  });

  it("points every document at the location of its group's name at the document's own site", async () => {
    const mapped = await rows<{ id: string; site_id: string; name: string; is_deleted: boolean }>(`
      select p.id, l.site_id, l.name, l.is_deleted
      from payments p join site_locations l on l.id = p.site_location_id
      order by p.id
    `);
    expect(mapped).toEqual([
      { id: PAY_MEMBER, site_id: SITE_B, name: "Riverside", is_deleted: false },
      { id: PAY_OUTSIDER, site_id: SITE_C, name: "Riverside", is_deleted: false },
      // A deleted group still names its document, through a deleted location.
      { id: PAY_DELETED, site_id: SITE_A, name: "Old Yard", is_deleted: true },
    ]);
  });

  it("copies a live group's addresses to each member site, numbered in order", async () => {
    const addresses = await rows<{ site_id: string; address: string; line_number: number }>(
      "select site_id, address, line_number from site_location_addresses order by site_id, line_number",
    );
    expect(addresses).toEqual([
      { site_id: SITE_A, address: "Gate 1, Riverside", line_number: 1 },
      { site_id: SITE_A, address: "Gate 2, Riverside", line_number: 2 },
      { site_id: SITE_B, address: "Gate 1, Riverside", line_number: 1 },
      { site_id: SITE_B, address: "Gate 2, Riverside", line_number: 2 },
    ]);
  });
});
