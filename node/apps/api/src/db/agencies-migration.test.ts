import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Migration 0021 GRANTS a new right on the live database — `agency.*` to
 * whoever may edit suppliers — so, like 0019, it is tested against a database
 * holding users and grants from before it. On an empty one the INSERT ... SELECT
 * selects nothing and every assertion about who got the right is vacuous.
 */

const MIGRATIONS_DIR = join(__dirname, "../../drizzle");
const TARGET = "0021_agencies";

function statementsFor(tags: string[]): string[] {
  return tags.flatMap((tag) =>
    readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean),
  );
}

const EDITOR = "00000000-0000-4000-8000-000000000001";
const VIEWER = "00000000-0000-4000-8000-000000000002";
/** Holds edit on BOTH the live Supplier row and a retired one — granted once, not twice. */
const DOUBLE = "00000000-0000-4000-8000-000000000003";

describe("migration 0021 — agencies", () => {
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
        ${user(EDITOR, "editor")}, ${user(VIEWER, "viewer")}, ${user(DOUBLE, "double")};
      insert into forms (id, form_name, form_group, is_active) values
        (7, 'Supplier', 'Masters', true),
        (40, 'Supplier', 'Masters', false);
      insert into user_form_permissions (user_id, form_id, is_view_allow, is_edit_allow) values
        ('${EDITOR}', 7, true, true),
        ('${VIEWER}', 7, true, false),
        ('${DOUBLE}', 7, true, true),
        ('${DOUBLE}', 40, true, true);
    `);

    for (const statement of statementsFor([TARGET])) await db.exec(statement);
  });

  it("adds the Agency form row, active, as id 101", async () => {
    expect(await rows(`select id, form_name, is_active from forms where id = 101`)).toEqual([
      { id: 101, form_name: "Agency", is_active: true },
    ]);
  });

  it("grants every agency right to supplier editors only, once each", async () => {
    const granted = await rows<{ user_id: string; is_add_allow: boolean; is_delete_allow: boolean }>(
      `select user_id, is_add_allow, is_delete_allow from user_form_permissions where form_id = 101 order by user_id`,
    );
    expect(granted).toEqual([
      { user_id: EDITOR, is_add_allow: true, is_delete_allow: true },
      { user_id: DOUBLE, is_add_allow: true, is_delete_allow: true },
    ]);
  });

  it("seeds the mockup's trades", async () => {
    const [count] = await rows<{ n: number }>(`select count(*)::int as n from work_types`);
    expect(count?.n).toBe(19);
  });

  it("refuses an agency whose city does not exist — geography is a real key here", async () => {
    await expect(
      db.exec(`insert into agencies (name, state_id, city_id) values ('Orphan', 999, 999)`),
    ).rejects.toThrow(/foreign key/);
  });
});
