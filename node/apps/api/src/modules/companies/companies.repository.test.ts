import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listQuerySchema } from "@accountmanagement/contracts";
import { CompaniesRepository } from "./companies.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

describe("CompaniesRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: CompaniesRepository;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new CompaniesRepository(db);

    await db.insert(schema.companies).values(
      Array.from({ length: 30 }, (_unused, i) => ({
        name: "Company " + String(i).padStart(2, "0"),
        gstNo: "24AAACD" + String(1000 + i) + "1Z5",
        panNo: "AAACD" + String(1000 + i) + "F",
        area: i % 2 === 0 ? "Navrangpura" : "Satellite",
        pincode: String(380001 + i),
        bankName: "HDFC Bank",
      })),
    );
  });

  it("walks every row exactly once across pages", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let guard = 0; guard < 20; guard++) {
      const page = await repo.list(query({ limit: 7, cursor }));
      seen.push(...page.rows.map((r) => r.name));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    expect(seen).toEqual([...seen].sort());
  });

  it("finds a company by GST number, not only by name", async () => {
    const page = await repo.list(query({ search: "24AAACD10071Z5" }));
    expect(page.rows.map((r) => r.name)).toEqual(["Company 07"]);
  });

  it("finds a company by PAN", async () => {
    const page = await repo.list(query({ search: "AAACD1012F" }));
    expect(page.rows.map((r) => r.name)).toEqual(["Company 12"]);
  });

  it("hides soft-deleted companies from both rows and total", async () => {
    await db
      .update(schema.companies)
      .set({ isDeleted: true })
      .where(eq(schema.companies.name, "Company 00"));

    const page = await repo.list(query({ limit: 100 }));
    expect(page.rows.map((r) => r.name)).not.toContain("Company 00");
    expect(await repo.total()).toBe(29);
  });

  it("counts users per company without duplicating the company row", async () => {
    const [company] = await db
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .limit(1);

    const inserted = await db
      .insert(schema.users)
      .values(
        Array.from({ length: 3 }, (_unused, i) => ({
          firstName: "First",
          lastName: "Last",
          email: "u" + i + "@example.com",
          phoneNo: "0",
          userName: "u" + i,
          password: "x",
        })),
      )
      .returning({ id: schema.users.id });

    await db
      .insert(schema.userCompanies)
      .values(inserted.map((u) => ({ userId: u.id, companyId: company!.id })));

    const page = await repo.list(query({ limit: 100 }));
    const row = page.rows.find((r) => r.id === company!.id)!;
    expect(row.userCount).toBe(3);
    expect(page.rows.filter((r) => r.id === company!.id)).toHaveLength(1);
  });

  it("counts the filtered set, not the whole table", async () => {
    expect(await repo.total()).toBe(30);
    expect(await repo.total("Company 1")).toBe(10);
  });

  it("never ships bank account numbers in the list payload", async () => {
    // The column exists; the list projection deliberately omits it. A grid that
    // any `company.view` holder can open must not carry account numbers.
    const page = await repo.list(query({ limit: 1 }));
    expect(page.rows[0]).not.toHaveProperty("accountNo");
    expect(page.rows[0]).not.toHaveProperty("ifscCode");
  });

  it("refuses two live companies with the same GST number", async () => {
    // Not enforced in SQL Server. A GST number identifies one legal entity.
    await expect(
      db.insert(schema.companies).values({ name: "Duplicate", gstNo: "24AAACD10001Z5" }),
    ).rejects.toThrow();
  });

  it("treats GST numbers case-insensitively for uniqueness", async () => {
    await expect(
      db.insert(schema.companies).values({ name: "Duplicate", gstNo: "24aaacd10001z5" }),
    ).rejects.toThrow();
  });
});
