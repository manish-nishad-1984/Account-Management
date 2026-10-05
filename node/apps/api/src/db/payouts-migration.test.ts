import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Migration 0022 GRANTS a new right on the live database — `payout.*` to whoever
 * holds Reports & Payments — so, like 0021, it runs against a database that
 * already has users and grants. On an empty one the INSERT ... SELECT selects
 * nothing and every assertion about who got the right is vacuous.
 */

const MIGRATIONS_DIR = join(__dirname, "../../drizzle");
const TARGET = "0022_payout_lists";

function statementsFor(tags: string[]): string[] {
  return tags.flatMap((tag) =>
    readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean),
  );
}

const VIEWER = "00000000-0000-4000-8000-000000000001";
const CLERK = "00000000-0000-4000-8000-000000000002";
const OUTSIDER = "00000000-0000-4000-8000-000000000003";
const NO_VIEW = "00000000-0000-4000-8000-000000000004";
/** Holds Reports & Payments on a live row and a retired one — granted once, from the live row. */
const DOUBLE = "00000000-0000-4000-8000-000000000005";

describe("migration 0022 — payout lists", () => {
  let db: PGlite;
  const rows = async <T>(query: string): Promise<T[]> => (await db.query<T>(query)).rows;

  beforeAll(async () => {
    db = await PGlite.create();
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const tags = [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.tag);
    expect(tags).toContain(TARGET);
    const before = tags.slice(0, tags.indexOf(TARGET));

    for (const statement of statementsFor(before)) await db.exec(statement);

    const user = (id: string, name: string) =>
      `('${id}', '${name}', 'User', '${name}@example.com', '9000000000', '${name}', 'x')`;
    await db.exec(`
      insert into users (id, first_name, last_name, email, phone_no, user_name, password) values
        ${user(VIEWER, "viewer")}, ${user(CLERK, "clerk")}, ${user(OUTSIDER, "outsider")},
        ${user(NO_VIEW, "noview")}, ${user(DOUBLE, "double")};
      insert into forms (id, form_name, form_group, is_active) values
        (13, 'Reports & Payments', 'Reports', true),
        (50, 'Reports & Payments', 'Reports', false);
      insert into user_form_permissions
        (user_id, form_id, is_view_allow, is_add_allow, is_edit_allow, is_delete_allow, is_approved) values
        ('${VIEWER}', 13, true, false, false, false, false),
        ('${CLERK}', 13, true, true, true, false, true),
        ('${NO_VIEW}', 13, false, true, true, true, false),
        ('${DOUBLE}', 13, true, true, false, false, false),
        ('${DOUBLE}', 50, true, true, true, true, false);
    `);

    for (const statement of statementsFor([TARGET])) await db.exec(statement);
  });

  it("adds the Payout form row, active, as id 102", async () => {
    expect(await rows(`select id, form_name, is_active from forms where id = 102`)).toEqual([
      { id: 102, form_name: "Payout", is_active: true },
    ]);
  });

  it("copies each holder's own flags, once, and never the approve right", async () => {
    const granted = await rows(
      `select user_id, is_view_allow, is_add_allow, is_edit_allow, is_delete_allow, is_approved
       from user_form_permissions where form_id = 102 order by user_id`,
    );
    expect(granted).toEqual([
      { user_id: VIEWER, is_view_allow: true, is_add_allow: false, is_edit_allow: false, is_delete_allow: false, is_approved: false },
      { user_id: CLERK, is_view_allow: true, is_add_allow: true, is_edit_allow: true, is_delete_allow: false, is_approved: false },
      // Only the LIVE Reports & Payments row counts, so the retired row's edit and delete are not copied.
      { user_id: DOUBLE, is_view_allow: true, is_add_allow: true, is_edit_allow: false, is_delete_allow: false, is_approved: false },
    ]);
  });

  it("creates both tables, empty", async () => {
    const [counts] = await rows<{ lists: number; lines: number }>(
      `select (select count(*) from payout_lists)::int as lists, (select count(*) from payout_list_lines)::int as lines`,
    );
    expect(counts).toEqual({ lists: 0, lines: 0 });
  });

  describe("the line constraints", () => {
    const SUPPLIER = "00000000-0000-4000-8000-0000000000a1";
    const LIST = "00000000-0000-4000-8000-0000000000b1";

    beforeAll(async () => {
      await db.exec(`
        insert into suppliers (id, name) values ('${SUPPLIER}', 'Shah');
        insert into payout_lists (id, list_date) values ('${LIST}', '2026-10-05');
      `);
    });

    const line = (amount: string) =>
      `insert into payout_list_lines (payout_list_id, party_id, amount, line_number)
       values ('${LIST}', '${SUPPLIER}', ${amount}, 1)`;

    it("refuses a zero amount", async () => {
      await expect(db.exec(line("0"))).rejects.toThrow(/payout_list_lines_amount_positive/);
    });

    it("refuses a negative amount", async () => {
      await expect(db.exec(line("-5.00"))).rejects.toThrow(/payout_list_lines_amount_positive/);
    });

    it("refuses the same party twice on one list", async () => {
      await db.exec(line("100.00"));
      await expect(db.exec(line("50.00"))).rejects.toThrow(/payout_list_lines_list_party_key/);
    });

    it("refuses a party that is not a supplier", async () => {
      await expect(
        db.exec(
          `insert into payout_list_lines (payout_list_id, party_id, amount, line_number)
           values ('${LIST}', '00000000-0000-4000-8000-0000000000ff', 1, 2)`,
        ),
      ).rejects.toThrow(/foreign key/);
    });
  });
});
