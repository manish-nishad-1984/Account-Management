import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createSupplierSchema, listQuerySchema } from "@accountmanagement/contracts";
import { SuppliersRepository } from "./suppliers.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

const input = (overrides: Record<string, unknown> = {}) =>
  createSupplierSchema.parse({ name: "Test Traders", area: "Navrangpura", ...overrides });

describe("SuppliersRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: SuppliersRepository;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new SuppliersRepository(db);
  });

  describe("listing", () => {
    beforeEach(async () => {
      await db.insert(schema.suppliers).values(
        Array.from({ length: 30 }, (_unused, i) => ({
          name: "Supplier " + String(i).padStart(2, "0"),
          area: i % 2 === 0 ? "Navrangpura" : "Satellite",
          mobile: "98" + String(25000000 + i),
          email: "supplier" + i + "@example.com",
          gstNo: "24AAACD" + String(1000 + i) + "A1Z5",
          isApproved: i % 3 !== 0,
        })),
      );
    });

    it("walks every row exactly once across pages", async () => {
      const seen: string[] = [];
      let cursor: string | undefined;

      for (let guard = 0; guard < 20; guard++) {
        const page = await repo.list(query({ limit: 7, cursor }));
        seen.push(...page.rows.map((row) => row.name));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      expect(seen).toHaveLength(30);
      expect(new Set(seen).size).toBe(30);
      expect(seen).toEqual([...seen].sort());
    });

    it("finds a supplier by mobile number, not only by name", async () => {
      const page = await repo.list(query({ search: "9825000007" }));
      expect(page.rows.map((row) => row.name)).toEqual(["Supplier 07"]);
    });

    it("finds a supplier by GST number", async () => {
      const page = await repo.list(query({ search: "24AAACD1012A1Z5" }));
      expect(page.rows.map((row) => row.name)).toEqual(["Supplier 12"]);
    });

    /**
     * Bank details are withheld from the list for the same reason as on
     * companies: a grid any `supplier.view` holder can open must not ship every
     * supplier's account number.
     */
    it("keeps bank details out of the list payload", async () => {
      const page = await repo.list(query({ limit: 1 }));
      const row = page.rows[0]!;

      expect(row).not.toHaveProperty("accountNo");
      expect(row).not.toHaveProperty("ifscCode");
      expect(row).not.toHaveProperty("bankName");
    });

    it("does ship the opening balance, which is a ledger figure rather than a credential", async () => {
      await repo.create(input({ name: "With Balance", openingBalance: "1500.75", openingBalanceDate: "2025-04-01" }), ACTOR);
      const page = await repo.list(query({ search: "With Balance" }));

      // A decimal STRING, never a number — see the note in fields.ts.
      expect(page.rows[0]!.openingBalance).toBe("1500.75");
    });

    it("hides soft-deleted suppliers from both rows and total", async () => {
      await db
        .update(schema.suppliers)
        .set({ isDeleted: true })
        .where(eq(schema.suppliers.name, "Supplier 00"));

      const page = await repo.list(query({ limit: 50 }));
      expect(page.rows.map((row) => row.name)).not.toContain("Supplier 00");
      expect(await repo.total()).toBe(29);
    });
  });

  describe("writes", () => {
    it("creates a supplier and stamps the caller", async () => {
      const created = await repo.create(input(), ACTOR);

      const [stored] = await db
        .select({ createdBy: schema.suppliers.createdBy })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, created.id));

      expect(created.name).toBe("Test Traders");
      expect(stored!.createdBy).toBe(ACTOR);
    });

    it("normalises a pasted mobile number, stripping +91 and spacing", async () => {
      const created = await repo.create(input({ mobile: "+91 98250 12345" }), ACTOR);
      expect(created.mobile).toBe("9825012345");
    });

    it("upper-cases GST and IFSC", async () => {
      const created = await repo.create(
        input({ gstNo: "24aaacd1234a1z5", ifscCode: "hdfc0001234" }),
        ACTOR,
      );

      expect(created.gstNo).toBe("24AAACD1234A1Z5");
      expect(created.ifscCode).toBe("HDFC0001234");
    });

    it("stores the opening balance as an exact decimal string", async () => {
      const created = await repo.create(
        input({ openingBalance: "1234.56", openingBalanceDate: "2025-04-01" }),
        ACTOR,
      );

      // The point of numeric-as-string: this is never 1234.5600000000001.
      expect(created.openingBalance).toBe("1234.56");
      expect(created.openingBalanceDate).toBe("2025-04-01T00:00:00.000Z");
    });

    it("refuses two live suppliers whose names differ only by case", async () => {
      await repo.create(input({ name: "Shah Traders" }), ACTOR);

      await expect(repo.create(input({ name: "shah traders" }), ACTOR)).rejects.toMatchObject({
        status: 409,
      });
    });

    it("frees the name again once the first supplier is soft-deleted", async () => {
      const first = await repo.create(input({ name: "Shah Traders" }), ACTOR);
      await repo.remove(first.id, ACTOR);

      // The unique index is partial on `is_deleted = false`, so this must succeed.
      await expect(repo.create(input({ name: "Shah Traders" }), ACTOR)).resolves.toMatchObject({
        name: "Shah Traders",
      });
    });

    /**
     * THIS TEST USED TO ASSERT THE OPPOSITE, AND THE RULE IT ASSERTED WAS WRONG.
     *
     * `suppliers_gst_no_key` was UNIQUE — a rule this port invented, which SQL
     * Server does not have. The client's live data refuses it: UltraTech Cement
     * is kept as three supplier rows on the one GST number, one per site and
     * product, which is how the business actually buys cement. Enforcing
     * uniqueness dropped 11 suppliers on import and took 34 invoices worth
     * Rs 46.4 lakh and 15 payments worth Rs 29.8 lakh down with them.
     *
     * So sharing a GST number must SUCCEED. Names are still unique among live
     * suppliers, which is why the two rows below are named differently — and
     * why the real data names them after the site each one buys for.
     */
    it("lets two live suppliers share a GST number", async () => {
      await repo.create(input({ name: "Ultratech - Ambika", gstNo: "24AAACL6442L1ZG" }), ACTOR);

      await expect(
        repo.create(input({ name: "Ultratech - Shivam", gstNo: "24AAACL6442L1ZG" }), ACTOR),
      ).resolves.toMatchObject({ gstNo: "24AAACL6442L1ZG" });
    });

    it("updates only what it is given", async () => {
      const created = await repo.create(input({ accountNo: "50200000000001" }), ACTOR);
      const updated = await repo.update(created.id, { isApproved: true }, ACTOR);

      expect(updated.isApproved).toBe(true);
      expect(updated.accountNo).toBe("50200000000001");
      expect(updated.name).toBe("Test Traders");
    });

    it("treats a soft-deleted supplier as gone", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      await expect(repo.findById(created.id)).rejects.toMatchObject({ status: 404 });
      await expect(repo.update(created.id, { name: "Zombie" }, ACTOR)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe("the contract's cross-field rules", () => {
    it("refuses an opening balance with no date to go with it", () => {
      expect(() =>
        createSupplierSchema.parse({
          name: "No Date",
          area: "X",
          openingBalance: "1000.00",
        }),
      ).toThrow();
    });

    it("accepts a balance with its date", () => {
      expect(() =>
        createSupplierSchema.parse({
          name: "With Date",
          area: "X",
          openingBalance: "1000.00",
          openingBalanceDate: "2025-04-01",
        }),
      ).not.toThrow();
    });

    it("refuses a GST number that is not 15 characters", () => {
      expect(() => createSupplierSchema.parse({ name: "Bad", area: "X", gstNo: "NOTAGST" })).toThrow();
    });

    it("refuses a mobile number that does not start 6-9", () => {
      expect(() => createSupplierSchema.parse({ name: "Bad", area: "X", mobile: "1234567890" })).toThrow();
    });

    it("requires an area, as the source column is NOT NULL", () => {
      expect(() => createSupplierSchema.parse({ name: "No Area" })).toThrow();
    });
  });
});
