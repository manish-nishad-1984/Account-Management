import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  createInwardChallanSchema,
  listQuerySchema,
  type CreateInwardChallan,
} from "@accountmanagement/contracts";
import { InwardChallansRepository } from "./inward-challans.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

describe("InwardChallansRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: InwardChallansRepository;
  let siteId: string;
  let otherSiteId: string;
  let itemId: string;
  let otherItemId: string;
  let supplierId: string;
  let otherSupplierId: string;
  let unitId: number;

  const input = (overrides: Record<string, unknown> = {}): CreateInwardChallan =>
    createInwardChallanSchema.parse({ siteId, itemId, unitId, quantity: "10.00", ...overrides });

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new InwardChallansRepository(db);

    const [unit] = await db
      .insert(schema.units)
      .values({ name: "Nos" })
      .returning({ id: schema.units.id });
    unitId = unit!.id;

    const insertedItems = await db
      .insert(schema.items)
      .values([
        { name: "FLY ASH BRICKS", unitId, pricePerUnit: "8.00" },
        { name: "GSB", unitId, pricePerUnit: "600.00" },
      ])
      .returning({ id: schema.items.id });
    itemId = insertedItems[0]!.id;
    otherItemId = insertedItems[1]!.id;

    const insertedSuppliers = await db
      .insert(schema.suppliers)
      .values([
        { name: "RAJU M PATEL-CARTING", area: "Navrangpura" },
        { name: "RAGHUNADAN CARTING", area: "Satellite" },
      ])
      .returning({ id: schema.suppliers.id });
    supplierId = insertedSuppliers[0]!.id;
    otherSupplierId = insertedSuppliers[1]!.id;

    const insertedSites = await db
      .insert(schema.sites)
      .values([{ name: "SURAT-AURO UNIVERSITY" }, { name: "Riverfront Phase 2" }])
      .returning({ id: schema.sites.id });
    siteId = insertedSites[0]!.id;
    otherSiteId = insertedSites[1]!.id;
  });

  describe("creating a challan", () => {
    /**
     * `AddItemInWordDetails` — the method in the REGISTERED repository — builds
     * the entity without `SupplierId` and without `InvoiceNo`, though the list it
     * feeds displays both. One create path here, and it writes what it is given.
     */
    it("records the supplier and the invoice number, which the source's live path drops", async () => {
      const created = await repo.create(input({ supplierId, invoiceNo: "253-1" }), ACTOR);

      expect(created.supplierId).toBe(supplierId);
      expect(created.invoiceNo).toBe("253-1");
    });

    /**
     * `AddItemInWordDetails` sets `Date = DateTime.Now` and ignores the date the
     * user typed, so a challan entered a week late is dated today.
     */
    it("keeps the date it was given rather than stamping today", async () => {
      const created = await repo.create(input({ documentDate: "2026-08-07" }), ACTOR);
      expect(created.documentDate?.slice(0, 10)).toBe("2026-08-07");
    });

    it("creates it unapproved", async () => {
      expect((await repo.create(input(), ACTOR)).isApproved).toBe(false);
    });

    it("upper-cases the vehicle number, as the source does", async () => {
      const created = await repo.create(input({ vehicleNumber: "gj 06 kk 1234" }), ACTOR);
      expect(created.vehicleNumber).toBe("GJ 06 KK 1234");
    });

    /**
     * `VehicleNumber.ToUpper()` throws a NullReferenceException when the field is
     * blank — and the column is nullable and the form does not require it.
     */
    it("accepts a blank vehicle number, where the source throws", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.vehicleNumber).toBeNull();
    });

    it("keeps the receiver as one free-text field, however it is written", async () => {
      const messy = "SURESHBHAI-CC-2000X2 7TH";
      const created = await repo.create(input({ receiverName: messy }), ACTOR);
      expect(created.receiverName).toBe(messy);
    });

    it("keeps an invoice number that is not a number", async () => {
      expect((await repo.create(input({ invoiceNo: "253-1" }), ACTOR)).invoiceNo).toBe("253-1");
    });

    it("refuses an item that does not exist", async () => {
      await expect(
        repo.create(input({ itemId: "99999999-9999-9999-9999-999999999999" }), ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("the list", () => {
    it("reads the item's current name from the master", async () => {
      await repo.create(input(), ACTOR);
      await db.update(schema.items).set({ name: "FLY ASH BRICKS (AAC)" }).where(eq(schema.items.id, itemId));

      const page = await repo.list(query());
      expect(page.rows[0]!.itemName).toBe("FLY ASH BRICKS (AAC)");
    });

    /**
     * `supplier_id` is nullable and the source's live create path never writes
     * it, so an inner join would hide every challan created that way.
     */
    it("returns a challan with no supplier", async () => {
      await repo.create(input(), ACTOR);

      const page = await repo.list(query());
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]!.supplierId).toBeNull();
      expect(page.rows[0]!.supplierName).toBeNull();
    });

    it("names the supplier when there is one", async () => {
      await repo.create(input({ supplierId }), ACTOR);
      expect((await repo.list(query())).rows[0]!.supplierName).toBe("RAJU M PATEL-CARTING");
    });

    it("counts the attachments without fetching their names", async () => {
      const created = await repo.create(input(), ACTOR);
      await db.insert(schema.inwardChallanDocuments).values([
        { challanId: created.id, documentName: "a.pdf" },
        { challanId: created.id, documentName: "b.jpg" },
      ]);

      expect((await repo.list(query())).rows[0]!.documentCount).toBe(2);
    });

    it("searches the invoice number and the vehicle, which the source cannot", async () => {
      await repo.create(input({ invoiceNo: "253-1", vehicleNumber: "GJ06KK1234" }), ACTOR);
      await repo.create(input({ itemId: otherItemId }), ACTOR);

      expect((await repo.list(query({ search: "253-1" }))).rows).toHaveLength(1);
      expect((await repo.list(query({ search: "KK1234" }))).rows).toHaveLength(1);
      expect((await repo.list(query({ search: "GSB" }))).rows).toHaveLength(1);
    });

    it("walks every row exactly once across pages", async () => {
      for (let i = 0; i < 11; i++) {
        await repo.create(input({ quantity: String(i + 1) + ".00" }), ACTOR);
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await repo.list(query({ limit: 4, cursor }));
        seen.push(...page.rows.map((r) => r.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      expect(new Set(seen).size).toBe(11);
    });

    /**
     * `document_date` is nullable, so it is not a sortable field: keyset paging
     * needs a NOT NULL column or every undated row silently disappears.
     */
    it("ignores a sort by the nullable date rather than dropping undated rows", async () => {
      await repo.create(input({ documentDate: "2026-08-07" }), ACTOR);
      await repo.create(input(), ACTOR);

      const page = await repo.list(query({ sortBy: "documentDate", limit: 1 }));
      const second = await repo.list(
        query({ sortBy: "documentDate", limit: 1, cursor: page.nextCursor! }),
      );

      expect([...page.rows, ...second.rows]).toHaveLength(2);
    });
  });

  /**
   * The legacy grid's purple footer row. The source computes this correctly and
   * then returns it by writing `TotalQuantity` onto `list[0]`, so it is LOST
   * whenever the filter matches nothing.
   */
  describe("the quantity total", () => {
    it("sums the whole filtered set, not the page", async () => {
      for (const q of ["4000.00", "2000.00", "37.81", "29.62"]) {
        await repo.create(input({ quantity: q }), ACTOR);
      }

      const totals = await repo.totals(undefined, {});
      expect(totals.rows).toBe(4);
      // Exact to the paisa: a decimal string in, a decimal string out.
      expect(totals.quantity).toBe("6067.43");
    });

    it("stays a decimal string, never a float", async () => {
      await repo.create(input({ quantity: "0.10" }), ACTOR);
      await repo.create(input({ quantity: "0.20" }), ACTOR);

      // 0.1 + 0.2 is 0.30000000000000004 in JavaScript. Not here.
      expect((await repo.totals()).quantity).toBe("0.30");
    });

    it("reports zero rather than vanishing when nothing matches", async () => {
      await repo.create(input({ quantity: "4000.00" }), ACTOR);

      const totals = await repo.totals(undefined, { supplierId: otherSupplierId });

      expect(totals.rows).toBe(0);
      expect(totals.quantity).toBe("0");
    });

    it("follows the filters, so a narrowed grid totals what it shows", async () => {
      await repo.create(input({ supplierId, quantity: "100.00" }), ACTOR);
      await repo.create(input({ supplierId: otherSupplierId, quantity: "50.00" }), ACTOR);

      expect((await repo.totals(undefined, { supplierId })).quantity).toBe("100.00");
    });

    it("drops a soft-deleted challan out of the total", async () => {
      const a = await repo.create(input({ quantity: "100.00" }), ACTOR);
      await repo.create(input({ quantity: "50.00" }), ACTOR);
      await repo.remove(a.id, ACTOR);

      expect((await repo.totals()).quantity).toBe("50.00");
    });
  });

  describe("the filters", () => {
    beforeEach(async () => {
      await repo.create(input({ supplierId, documentDate: "2026-06-03" }), ACTOR);
      await repo.create(
        input({ itemId: otherItemId, supplierId: otherSupplierId, documentDate: "2026-08-26" }),
        ACTOR,
      );
      await repo.create(input({ siteId: otherSiteId, documentDate: "2026-09-06" }), ACTOR);
    });

    it("narrows by site", async () => {
      expect((await repo.list(query(), { siteId })).rows).toHaveLength(2);
    });

    it("narrows by supplier", async () => {
      expect((await repo.list(query(), { supplierId })).rows).toHaveLength(1);
    });

    it("narrows by item", async () => {
      expect((await repo.list(query(), { itemId: otherItemId })).rows).toHaveLength(1);
    });

    /**
     * `GetItemInWordList` accepts startDate and enddate and the screen never
     * sends them, so the capability exists in the source and is unreachable.
     */
    it("narrows by a date range, which the source supports and never uses", async () => {
      const page = await repo.list(query(), { fromDate: "2026-08-01", toDate: "2026-08-31" });
      expect(page.rows).toHaveLength(1);
    });

    it("combines filters rather than letting the last one win", async () => {
      const page = await repo.list(query(), { siteId, supplierId: otherSupplierId });
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]!.itemId).toBe(otherItemId);
    });
  });

  describe("approval and deletion", () => {
    it("sets approval to the stated value rather than flipping it", async () => {
      const created = await repo.create(input(), ACTOR);

      expect((await repo.setApproval(created.id, true, ACTOR)).isApproved).toBe(true);
      expect((await repo.setApproval(created.id, true, ACTOR)).isApproved).toBe(true);
    });

    it("soft deletes, as the source does here", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      const [row] = await db
        .select({ isDeleted: schema.inwardChallans.isDeleted })
        .from(schema.inwardChallans)
        .where(eq(schema.inwardChallans.id, created.id));

      expect(row!.isDeleted).toBe(true);
      expect((await repo.list(query())).rows).toHaveLength(0);
    });

    it("refuses a second delete", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);
      await expect(repo.remove(created.id, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * The dashboard queue's select-all.
     *
     * `MultipleItemInWordIsApproved` is one of the seven finding-P2 methods: it
     * loaded every row in the table and called `Update()` on all of them, so
     * approving two challans issued an UPDATE against every challan.
     */
    describe("bulk approval", () => {
      it("approves the named rows and reports how many changed", async () => {
        const a = await repo.create(input(), ACTOR);
        const b = await repo.create(input(), ACTOR);

        expect(await repo.setApprovalMany([a.id, b.id], true, ACTOR)).toBe(2);
        expect((await repo.findById(a.id)).isApproved).toBe(true);
        expect((await repo.findById(b.id)).isApproved).toBe(true);
      });

      it("skips rows already approved, so a select-all cannot flip them off", async () => {
        const pending = await repo.create(input(), ACTOR);
        const approved = await repo.create(input(), ACTOR);
        await repo.setApproval(approved.id, true, ACTOR);

        expect(await repo.setApprovalMany([pending.id, approved.id], true, ACTOR)).toBe(1);
        expect((await repo.findById(approved.id)).isApproved).toBe(true);
      });

      it("leaves rows that were not named alone", async () => {
        const named = await repo.create(input(), ACTOR);
        const untouched = await repo.create(input(), ACTOR);

        await repo.setApprovalMany([named.id], true, ACTOR);
        expect((await repo.findById(untouched.id)).isApproved).toBe(false);
      });

      it("ignores a soft-deleted challan", async () => {
        const gone = await repo.create(input(), ACTOR);
        await repo.remove(gone.id, ACTOR);

        expect(await repo.setApprovalMany([gone.id], true, ACTOR)).toBe(0);
      });

      it("is a no-op on an empty list", async () => {
        expect(await repo.setApprovalMany([], true, ACTOR)).toBe(0);
      });
    });
  });

  describe("the detail", () => {
    it("carries an ETL attachment as a name with nothing to download", async () => {
      const created = await repo.create(input(), ACTOR);
      // Exactly what the ETL produces: the source records a file NAME and no
      // location, because its own table records nothing else.
      await db
        .insert(schema.inwardChallanDocuments)
        .values({ challanId: created.id, documentName: "weighbridge.jpg" });

      const detail = await repo.findById(created.id);
      expect(detail.documents.map((d) => d.documentName)).toEqual(["weighbridge.jpg"]);
      expect(detail.documents[0]!.isDownloadable).toBe(false);
      expect(detail.documents[0]!.contentType).toBeNull();
      expect(detail.documents[0]!.sizeBytes).toBeNull();
    });

    it("never puts a storage key on the wire", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.addDocument(
        created.id,
        {
          documentName: "challan.pdf",
          storageKey: "inward-challans/x/secret-location.pdf",
          contentType: "application/pdf",
          sizeBytes: 1234,
        },
        ACTOR,
      );

      const detail = await repo.findById(created.id);
      // The location is a server-side detail. Publishing it tells a client where
      // the file lives and invites it to build its own URL from it.
      expect(JSON.stringify(detail)).not.toContain("secret-location");
      expect(detail.documents[0]).toMatchObject({
        documentName: "challan.pdf",
        contentType: "application/pdf",
        sizeBytes: 1234,
        isDownloadable: true,
      });
    });

    it("updates every field it is given, unlike the source's single-row update", async () => {
      const created = await repo.create(input(), ACTOR);

      // UpdateItemInWordDetails omits SiteId, SupplierId and InvoiceNo entirely.
      const updated = await repo.update(
        created.id,
        { siteId: otherSiteId, supplierId, invoiceNo: "922" },
        ACTOR,
      );

      expect(updated.siteId).toBe(otherSiteId);
      expect(updated.supplierId).toBe(supplierId);
      expect(updated.invoiceNo).toBe("922");
    });
  });
});
