import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Migration 0027 GRANTS a new right on the live database — `balance-sheets.*` to
 * whoever holds Income — so it runs against a database that already has users and
 * grants. On an empty one the INSERT ... SELECT selects nothing and every
 * assertion about who got the right is vacuous.
 */

const MIGRATIONS_DIR = join(__dirname, "../../drizzle");
const TARGET = "0027_balance_sheets";

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

describe("migration 0027 — balance sheets", () => {
  let db: PGlite;
  const rows = async <T>(query: string): Promise<T[]> => (await db.query<T>(query)).rows;

  beforeAll(async () => {
    db = await PGlite.create();
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const tags = [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.tag);
    expect(tags).toContain(TARGET);
    for (const statement of statementsFor(tags.slice(0, tags.indexOf(TARGET)))) await db.exec(statement);

    const user = (id: string, name: string) =>
      `('${id}', '${name}', 'User', '${name}@example.com', '9000000000', '${name}', 'x')`;
    await db.exec(`
      insert into users (id, first_name, last_name, email, phone_no, user_name, password) values
        ${user(VIEWER, "viewer")}, ${user(CLERK, "clerk")}, ${user(OUTSIDER, "outsider")}, ${user(NO_VIEW, "noview")};
      insert into forms (id, form_name, form_group, is_active) values (104, 'Income', 'Reports', true)
        on conflict (id) do nothing;
      insert into user_form_permissions
        (user_id, form_id, is_view_allow, is_add_allow, is_edit_allow, is_delete_allow, is_approved) values
        ('${VIEWER}', 104, true, false, false, false, false),
        ('${CLERK}', 104, true, true, true, false, true),
        ('${NO_VIEW}', 104, false, true, true, true, false)
      on conflict do nothing;
    `);

    for (const statement of statementsFor([TARGET])) await db.exec(statement);
  });

  it("adds the Balance Sheets form row, active, as id 105", async () => {
    expect(await rows(`select id, form_name, is_active from forms where id = 105`)).toEqual([
      { id: 105, form_name: "Balance Sheets", is_active: true },
    ]);
  });

  it("copies each Income holder's own flags, never the approve right, and skips a row without view", async () => {
    const granted = await rows(
      `select user_id, is_view_allow, is_add_allow, is_edit_allow, is_delete_allow, is_approved
       from user_form_permissions where form_id = 105 order by user_id`,
    );
    expect(granted).toEqual([
      { user_id: VIEWER, is_view_allow: true, is_add_allow: false, is_edit_allow: false, is_delete_allow: false, is_approved: false },
      { user_id: CLERK, is_view_allow: true, is_add_allow: true, is_edit_allow: true, is_delete_allow: false, is_approved: false },
    ]);
  });

  it("creates both tables, empty", async () => {
    const [counts] = await rows<{ sheets: number; lines: number }>(
      `select (select count(*) from balance_sheets)::int as sheets, (select count(*) from balance_sheet_rows)::int as lines`,
    );
    expect(counts).toEqual({ sheets: 0, lines: 0 });
  });
});
