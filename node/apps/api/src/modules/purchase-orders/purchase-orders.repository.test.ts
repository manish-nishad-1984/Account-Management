import { beforeEach, describe, expect, it } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  createPurchaseOrderSchema,
  TERMS_TEMPLATES,
  listQuerySchema,
  updatePurchaseOrderSchema,
  type CreatePurchaseOrder,
} from "@accountmanagement/contracts";
import { financialYear } from "@accountmanagement/domain";
import { PurchaseOrdersRepository } from "./purchase-orders.repository";
import { PurchaseRequestsRepository } from "../purchase-requests/purchase-requests.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const patch = (body: Record<string, unknown>) => updatePurchaseOrderSchema.parse(body);

const ACTOR = "11111111-1111-1111-1111-111111111111";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

const FY = financialYear.format(financialYear.currentAsProduced(new Date()));

describe("PurchaseOrdersRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: PurchaseOrdersRepository;
  let siteId: string;
  let supplierId: string;
  let companyId: string;
  let otherCompanyId: string;
  let noPrefixCompanyId: string;
  let itemId: string;
  let unitId: number;

  const input = (overrides: Record<string, unknown> = {}): CreatePurchaseOrder =>
    createPurchaseOrderSchema.parse({
      siteId,
      supplierId,
      companyId,
      items: [{ itemId, unitId, quantity: "3", unitPrice: "1000.00", gstPercent: "18" }],
      ...overrides,
    });

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new PurchaseOrdersRepository(db);

    const [unit] = await db
      .insert(schema.units)
      .values({ name: "Bag" })
      .returning({ id: schema.units.id });
    unitId = unit!.id;

    const [item] = await db
      .insert(schema.items)
      .values({ name: "OPC 53 Grade Cement", unitId, pricePerUnit: "395.00", hsnCode: "25232910" })
      .returning({ id: schema.items.id });
    itemId = item!.id;

    const [site] = await db
      .insert(schema.sites)
      .values({ name: "Akwada Lake Front", isActive: true })
      .returning({ id: schema.sites.id });
    siteId = site!.id;

    const [supplier] = await db
      .insert(schema.suppliers)
      .values({ name: "ASIAN GRANITO INDIA LIMITED", area: "Navrangpura" })
      .returning({ id: schema.suppliers.id });
    supplierId = supplier!.id;

    const inserted = await db
      .insert(schema.companies)
      .values([
        { name: "DH PATEL", invoicePrefix: "DHP" },
        { name: "DEMO", invoicePrefix: "DEMO" },
        { name: "NO PREFIX LTD", invoicePrefix: null },
      ])
      .returning({ id: schema.companies.id, name: schema.companies.name });

    companyId = inserted.find((row) => row.name === "DH PATEL")!.id;
    otherCompanyId = inserted.find((row) => row.name === "DEMO")!.id;
    noPrefixCompanyId = inserted.find((row) => row.name === "NO PREFIX LTD")!.id;
  });

  describe("document numbering", () => {
    it("leads the number with the company's invoice prefix", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.poNo).toBe(`DHP/PO/${FY}/001`);
    });

    it("counts per company, so two companies both reach 001", async () => {
      const first = await repo.create(input(), ACTOR);
      const second = await repo.create(input({ companyId: otherCompanyId }), ACTOR);

      expect(first.poNo).toBe(`DHP/PO/${FY}/001`);
      expect(second.poNo).toBe(`DEMO/PO/${FY}/001`);
    });

    it("increments within a company without disturbing the other", async () => {
      await repo.create(input(), ACTOR);
      await repo.create(input({ companyId: otherCompanyId }), ACTOR);
      const third = await repo.create(input(), ACTOR);

      expect(third.poNo).toBe(`DHP/PO/${FY}/002`);
    });

    /**
     * The source parses the previous number out of the string with a regex and
     * has no counter at all, so this is the shape of failure it cannot avoid:
     * two callers reading the same "last" row. Fifteen crosses the point where a
     * substring-based parser would wrap.
     */
    it("issues fifteen distinct, ordered numbers", async () => {
      const numbers: string[] = [];
      for (let i = 0; i < 15; i += 1) {
        numbers.push((await repo.create(input(), ACTOR)).poNo);
      }

      expect(new Set(numbers).size).toBe(15);
      expect(numbers.at(-1)).toBe(`DHP/PO/${FY}/015`);
      expect([...numbers].sort()).toEqual(numbers);
    });

    /**
     * A company with no invoice prefix cannot be numbered.
     *
     * `CheckPONo` reads `CompanyDetails.InvoicePef.Trim()` with no null check —
     * a NullReferenceException for exactly this row — and the catch around it
     * returns the string "Error generating Purchase Order number." AS THE NUMBER.
     */
    it("refuses an order for a company with no invoice prefix, by name", async () => {
      await expect(repo.create(input({ companyId: noPrefixCompanyId }), ACTOR)).rejects.toThrow(
        BadRequestException,
      );
      await expect(repo.create(input({ companyId: noPrefixCompanyId }), ACTOR)).rejects.toThrow(
        /NO PREFIX LTD has no invoice prefix/,
      );
    });

    it("burns no number when the insert fails", async () => {
      // A line naming a unit that does not exist violates the FK, so the whole
      // transaction rolls back — including the counter increment.
      await expect(
        repo.create(input({ items: [{ itemId, unitId: 99999, quantity: "1", unitPrice: "1" }] }), ACTOR),
      ).rejects.toThrow();

      const after = await repo.create(input(), ACTOR);
      expect(after.poNo).toBe(`DHP/PO/${FY}/001`);
    });

    /**
     * The purchase request sequence must be untouched by the company dimension.
     * Both counters live in one table now, and PR rows carry a NULL company —
     * which is why the uniqueness is two partial indexes rather than one.
     */
    it("does not disturb the global purchase request sequence", async () => {
      const requests = new PurchaseRequestsRepository(db);

      await repo.create(input(), ACTOR);
      const request = await requests.create(
        { siteId, itemId, itemName: null, itemDescription: null, unitId, quantity: "5.00", documentDate: null, siteAddressId: null, siteAddress: null },
        ACTOR,
      );
      const second = await requests.create(
        { siteId, itemId, itemName: null, itemDescription: null, unitId, quantity: "5.00", documentDate: null, siteAddressId: null, siteAddress: null },
        ACTOR,
      );

      expect(request.prNo).toBe(`PR/${FY}/001`);
      expect(second.prNo).toBe(`PR/${FY}/002`);
    });
  });

  describe("totals are computed on the server", () => {
    it("prices the lines and rolls them up", async () => {
      const created = await repo.create(
        input({
          items: [
            { itemId, unitId, quantity: "3", unitPrice: "1000.00", gstPercent: "18" },
            { itemId, unitId, quantity: "1", unitPrice: "27.00", gstPercent: "18" },
          ],
        }),
        ACTOR,
      );

      expect(created.subtotal).toBe("3027.00");
      expect(created.totalGstAmount).toBe("544.86");
      expect(created.totalAmount).toBe("3571.86");
    });

    it("derives each line's GST and total", async () => {
      const created = await repo.create(input(), ACTOR);

      expect(created.items).toHaveLength(1);
      expect(created.items[0]).toMatchObject({
        quantity: "3.00",
        unitPrice: "1000.00",
        gstAmount: "540.00",
        lineTotal: "3540.00",
        lineNumber: 1,
      });
    });

    /**
     * The client cannot set a total. The source stores whatever the browser
     * posted, so a crafted request books an order at any value it likes.
     */
    it("ignores totals sent in the body", async () => {
      const created = await repo.create(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { ...(input() as any), totalAmount: "1.00", subtotal: "1.00", totalGstAmount: "1.00" },
        ACTOR,
      );

      expect(created.totalAmount).toBe("3540.00");
    });

    it("keeps the discount column out of the arithmetic", async () => {
      // The create screen has no discount field at all; the column exists only so
      // the ETL is lossless. Applying it would change what historical orders are
      // worth.
      const created = await repo.create(
        input({
          items: [
            { itemId, unitId, quantity: "3", unitPrice: "1000.00", gstPercent: "18", discount: "500.00" },
          ],
        }),
        ACTOR,
      );

      expect(created.totalAmount).toBe("3540.00");
    });

    it("recomputes the totals when the lines are replaced", async () => {
      const created = await repo.create(input(), ACTOR);

      const updated = await repo.update(created.id, patch({ items: [{ itemId, unitId, quantity: "1", unitPrice: "100.00", gstPercent: "5" }] }), ACTOR);

      expect(updated.items).toHaveLength(1);
      expect(updated.subtotal).toBe("100.00");
      expect(updated.totalAmount).toBe("105.00");
    });

    it("leaves the lines and totals alone when the update does not mention them", async () => {
      const created = await repo.create(input(), ACTOR);
      const updated = await repo.update(created.id, { buyersPurchaseNo: "PO-9912" }, ACTOR);

      expect(updated.buyersPurchaseNo).toBe("PO-9912");
      expect(updated.items).toHaveLength(1);
      expect(updated.totalAmount).toBe("3540.00");
    });
  });

  describe("lines", () => {
    it("labels a free-text line by its own text, with no catalogue row", async () => {
      const created = await repo.create(
        input({
          items: [{ itemName: "Scaffolding hire", unitId, quantity: "2", unitPrice: "50.00" }],
        }),
        ACTOR,
      );

      expect(created.items[0]).toMatchObject({
        itemId: null,
        itemLabel: "Scaffolding hire",
        hsnCode: null,
      });
    });

    it("carries the catalogue item's HSN code onto the line", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.items[0]!.hsnCode).toBe("25232910");
    });

    it("numbers the lines in the order they were sent", async () => {
      const created = await repo.create(
        input({
          items: [
            { itemName: "First", unitId, quantity: "1", unitPrice: "1.00" },
            { itemName: "Second", unitId, quantity: "1", unitPrice: "2.00" },
            { itemName: "Third", unitId, quantity: "1", unitPrice: "3.00" },
          ],
        }),
        ACTOR,
      );

      expect(created.items.map((line) => [line.lineNumber, line.itemLabel])).toEqual([
        [1, "First"],
        [2, "Second"],
        [3, "Third"],
      ]);
    });

    it("refuses an order with no lines", () => {
      expect(() => input({ items: [] })).toThrow(/Add at least one product/);
    });
  });

  describe("list", () => {
    it("joins the site, supplier and company names", async () => {
      await repo.create(input(), ACTOR);
      const { rows } = await repo.list(query());

      expect(rows[0]).toMatchObject({
        siteName: "Akwada Lake Front",
        supplierName: "ASIAN GRANITO INDIA LIMITED",
        companyName: "DH PATEL",
        lineCount: 1,
      });
    });

    it("counts the lines without fetching them", async () => {
      await repo.create(
        input({
          items: [
            { itemName: "a", unitId, quantity: "1", unitPrice: "1.00" },
            { itemName: "b", unitId, quantity: "1", unitPrice: "1.00" },
          ],
        }),
        ACTOR,
      );

      const { rows } = await repo.list(query());
      expect(rows[0]!.lineCount).toBe(2);
    });

    it("filters by active, which the legacy list defaults to", async () => {
      const active = await repo.create(input(), ACTOR);
      const inactive = await repo.create(input(), ACTOR);
      await db
        .update(schema.purchaseOrders)
        .set({ isActive: false })
        .where(eq(schema.purchaseOrders.id, inactive.id));

      const { rows } = await repo.list(query(), { isActive: true });
      expect(rows.map((row) => row.id)).toEqual([active.id]);
    });

    it("returns everything when isActive is not given", async () => {
      await repo.create(input(), ACTOR);
      const second = await repo.create(input(), ACTOR);
      await db
        .update(schema.purchaseOrders)
        .set({ isActive: false })
        .where(eq(schema.purchaseOrders.id, second.id));

      expect((await repo.list(query())).rows).toHaveLength(2);
    });

    it("searches the number, the buyer's number and the supplier", async () => {
      await repo.create(input({ buyersPurchaseNo: "ACME-77" }), ACTOR);
      await repo.create(input(), ACTOR);

      expect((await repo.list(query({ search: "ACME-77" }))).rows).toHaveLength(1);
      expect((await repo.list(query({ search: "ASIAN" }))).rows).toHaveLength(2);
      expect((await repo.list(query({ search: `DHP/PO/${FY}/002` }))).rows).toHaveLength(1);
    });

    it("hides soft-deleted orders", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      expect((await repo.list(query())).rows).toHaveLength(0);
      expect(await repo.total()).toBe(0);
    });

    /** §5i: paging by a timestamp cursor threw before `keysetWhere` cast it. */
    it("pages past the first page when sorted by createdAt", async () => {
      for (let i = 0; i < 5; i += 1) {
        await repo.create(input(), ACTOR);
      }

      const first = await repo.list(query({ sortBy: "createdAt", limit: 2 }));
      expect(first.nextCursor).not.toBeNull();

      const second = await repo.list(
        query({ sortBy: "createdAt", limit: 2, cursor: first.nextCursor! }),
      );
      expect(second.rows).toHaveLength(2);
      expect(second.rows.map((row) => row.id)).not.toEqual(first.rows.map((row) => row.id));
    });
  });

  describe("approval", () => {
    it("states the approval rather than toggling it", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.isApproved).toBe(false);

      const approved = await repo.setApproval(created.id, true, ACTOR);
      expect(approved.isApproved).toBe(true);

      const again = await repo.setApproval(created.id, true, ACTOR);
      expect(again.isApproved).toBe(true);
    });

    it("counts only the rows a bulk approval actually changed", async () => {
      const first = await repo.create(input(), ACTOR);
      const second = await repo.create(input(), ACTOR);
      await repo.setApproval(first.id, true, ACTOR);

      expect(await repo.setApprovalMany([first.id, second.id], true, ACTOR)).toBe(1);
      expect(await repo.setApprovalMany([first.id, second.id], true, ACTOR)).toBe(0);
    });

    it("is a no-op for an empty selection", async () => {
      expect(await repo.setApprovalMany([], true, ACTOR)).toBe(0);
    });
  });

  describe("delete", () => {
    it("soft-deletes, keeping the lines for reconstruction", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      const lines = await db
        .select()
        .from(schema.purchaseOrderItems)
        .where(eq(schema.purchaseOrderItems.purchaseOrderId, created.id));

      expect(lines).toHaveLength(1);
    });

    it("404s on a second delete", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      await expect(repo.remove(created.id, ACTOR)).rejects.toThrow(NotFoundException);
    });

    it("404s reading a deleted order", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      await expect(repo.findById(created.id)).rejects.toThrow(NotFoundException);
    });
  });

  describe("delivery schedule", () => {
    /**
     * One legacy string column held either a date or the word "Immediate". Split
     * into a nullable date plus a boolean, so "nobody said" stays distinguishable
     * from "immediate" — the source cannot express that difference at all.
     */
    it("records immediate delivery with no date", async () => {
      const created = await repo.create(input({ deliveryImmediate: true }), ACTOR);

      expect(created.deliveryImmediate).toBe(true);
      expect(created.deliveryDate).toBeNull();
    });

    it("records a scheduled date with the flag off", async () => {
      const created = await repo.create(
        input({ deliveryDate: "2026-10-01T00:00:00.000Z" }),
        ACTOR,
      );

      expect(created.deliveryImmediate).toBe(false);
      expect(created.deliveryDate).not.toBeNull();
    });

    it("leaves both empty when nobody said", async () => {
      const created = await repo.create(input(), ACTOR);

      expect(created.deliveryImmediate).toBe(false);
      expect(created.deliveryDate).toBeNull();
    });
  });

  /**
   * The two address panels of `08-create-purchase-order.md`, left as a carve-out
   * when the rest of the screen shipped.
   */
  describe("delivery addresses", () => {
    const site = (quantity: string, address = "Plot 4, GIDC Estate") => ({
      kind: "site" as const,
      address,
      quantity,
    });
    const group = (quantity: string, address = "Ward 3, Colony Office") => ({
      kind: "group" as const,
      address,
      quantity,
    });

    it("stores both panels' rows against the order, in the order they were keyed", async () => {
      const created = await repo.create(
        input({ deliveryAddresses: [site("2"), group("1")] }),
        ACTOR,
      );

      expect(created.deliveryAddresses).toHaveLength(2);
      expect(created.deliveryAddresses.map((row) => [row.kind, row.lineNumber])).toEqual([
        ["site", 1],
        ["group", 2],
      ]);
    });

    it("keeps a decimal quantity, which the source's int column cannot", async () => {
      const created = await repo.create(input({ deliveryAddresses: [site("1.50")] }), ACTOR);
      expect(created.deliveryAddresses[0]!.quantity).toBe("1.50");
    });

    it("saves an order with no delivery addresses at all", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.deliveryAddresses).toEqual([]);
    });

    it("stores an address containing the source's own Group- marker unchanged", async () => {
      // The source posts group rows prefixed with "Group-" and strips the marker
      // with `Replace`, which removes it from any position. This address comes
      // back as "Ward 3, B Quarters" there.
      const created = await repo.create(
        input({ deliveryAddresses: [group("1", "Ward 3, Group-B Quarters")] }),
        ACTOR,
      );
      expect(created.deliveryAddresses[0]!.address).toBe("Ward 3, Group-B Quarters");
    });

    it("keeps two rows that carry the same address text", async () => {
      // The source matches existing rows BY ADDRESS TEXT on update, so two rows
      // sharing one address collapse into one there.
      const created = await repo.create(
        input({ deliveryAddresses: [site("1", "Gate 2"), group("2", "Gate 2")] }),
        ACTOR,
      );
      expect(created.deliveryAddresses).toHaveLength(2);
    });

    it("replaces the addresses wholesale on update", async () => {
      const created = await repo.create(
        input({ deliveryAddresses: [site("1"), group("1")] }),
        ACTOR,
      );

      const updated = await repo.update(
        created.id,
        patch({ deliveryAddresses: [site("3", "Yard 7")] }),
        ACTOR,
      );

      expect(updated.deliveryAddresses).toHaveLength(1);
      expect(updated.deliveryAddresses[0]!.address).toBe("Yard 7");
      expect(updated.deliveryAddresses[0]!.lineNumber).toBe(1);
    });

    it("clears them when an empty list is sent", async () => {
      const created = await repo.create(input({ deliveryAddresses: [site("1")] }), ACTOR);
      const updated = await repo.update(created.id, patch({ deliveryAddresses: [] }), ACTOR);
      expect(updated.deliveryAddresses).toEqual([]);
    });

    it("leaves them alone when the update does not mention them", async () => {
      const created = await repo.create(input({ deliveryAddresses: [site("1")] }), ACTOR);
      const updated = await repo.update(created.id, patch({ buyersPurchaseNo: "X" }), ACTOR);
      expect(updated.deliveryAddresses).toHaveLength(1);
    });

    it("goes with the order when the order is really deleted", async () => {
      const created = await repo.create(input({ deliveryAddresses: [site("1")] }), ACTOR);
      await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, created.id));

      const left = await db
        .select()
        .from(schema.purchaseOrderDeliveryAddresses)
        .where(eq(schema.purchaseOrderDeliveryAddresses.purchaseOrderId, created.id));
      expect(left).toEqual([]);
    });

    /**
     * THE DEPARTURE. The order is for 3 units; the source's two independent
     * accumulators each see 3, neither exceeds it, and it saves 6 units of
     * deliveries against a 3 unit order. See `domain/delivery-allocation.ts`.
     */
    describe("the quantity rule", () => {
      it("refuses more than was ordered, counting both panels together", async () => {
        await expect(
          repo.create(input({ deliveryAddresses: [site("3"), group("3")] }), ACTOR),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it("accepts exactly the ordered quantity across both panels", async () => {
        const created = await repo.create(
          input({ deliveryAddresses: [site("2"), group("1")] }),
          ACTOR,
        );
        expect(created.deliveryAddresses).toHaveLength(2);
      });

      it("accepts a part allocation", async () => {
        const created = await repo.create(input({ deliveryAddresses: [site("1")] }), ACTOR);
        expect(created.deliveryAddresses).toHaveLength(1);
      });

      it("names both totals in the message", async () => {
        await expect(repo.create(input({ deliveryAddresses: [site("4")] }), ACTOR)).rejects.toThrow(
          /4\.00 units, and the order is for 3\.00/,
        );
      });

      it("issues no document number when the allocation is refused", async () => {
        // The counter increments inside the insert's transaction, so a request
        // that was always going to fail must fail before it opens one —
        // otherwise a rejected save burns an order number and the sequence gains
        // a permanent gap that nothing explains.
        await expect(
          repo.create(input({ deliveryAddresses: [site("9")] }), ACTOR),
        ).rejects.toBeInstanceOf(BadRequestException);

        const next = await repo.create(input(), ACTOR);
        expect(next.poNo).toBe(`DHP/PO/${FY}/001`);
      });

      it("checks new addresses against the lines already stored", async () => {
        const created = await repo.create(input(), ACTOR);
        await expect(
          repo.update(created.id, patch({ deliveryAddresses: [site("4")] }), ACTOR),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      /**
       * The case a naive implementation misses entirely: the request mentions no
       * address at all, and it is still the request that breaks the rule.
       */
      it("checks stored addresses against new lines when only the lines change", async () => {
        const created = await repo.create(input({ deliveryAddresses: [site("3")] }), ACTOR);

        await expect(
          repo.update(
            created.id,
            patch({ items: [{ itemId, unitId, quantity: "1", unitPrice: "1000.00" }] }),
            ACTOR,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it("leaves the order untouched when an update is refused", async () => {
        const created = await repo.create(input({ deliveryAddresses: [site("3")] }), ACTOR);

        await expect(
          repo.update(created.id, patch({ deliveryAddresses: [site("3"), group("3")] }), ACTOR),
        ).rejects.toBeInstanceOf(BadRequestException);

        const after = await repo.findById(created.id);
        expect(after.deliveryAddresses).toHaveLength(1);
        expect(after.deliveryAddresses[0]!.quantity).toBe("3.00");
      });
    });
  });

  describe("terms and conditions", () => {
    it("stores a template's html unchanged", async () => {
      const template = TERMS_TEMPLATES[0]!;
      const created = await repo.create(
        input({ terms: template.html, termsTemplate: template.key }),
        ACTOR,
      );

      expect(created.terms).toBe(template.html);
      expect(created.termsTemplate).toBe("template-1");
    });

    /**
     * The whole reason this column held plain text until now: the legacy print
     * view renders it with `@Html.Raw`, so anything stored here runs for every
     * reader of the order.
     */
    it("strips markup that is not on the allowlist", async () => {
      const created = await repo.create(
        input({ terms: '<p>Payment in 30 days</p><script>fetch("//evil")</script>' }),
        ACTOR,
      );

      expect(created.terms).toBe("<p>Payment in 30 days</p>");
    });

    it("strips it on update too, not only on create", async () => {
      const created = await repo.create(input({ terms: "<p>Clean</p>" }), ACTOR);
      const updated = await repo.update(
        created.id,
        patch({ terms: '<p>Still clean</p><img src=x onerror="steal()">' }),
        ACTOR,
      );

      expect(updated.terms).toBe("<p>Still clean</p>");
    });

    it("stores null for terms that were emptied in the editor", async () => {
      const created = await repo.create(input({ terms: "<p>Something</p>" }), ACTOR);
      const updated = await repo.update(created.id, patch({ terms: "<p><br></p>" }), ACTOR);
      expect(updated.terms).toBeNull();
    });

    it("leaves the terms alone when the update does not mention them", async () => {
      const created = await repo.create(input({ terms: "<p>Kept</p>" }), ACTOR);
      const updated = await repo.update(created.id, patch({ buyersPurchaseNo: "X" }), ACTOR);
      expect(updated.terms).toBe("<p>Kept</p>");
    });

    it("reads an unrecognised stored template as none, rather than failing the row", async () => {
      // What an imported row carrying the legacy "Term-1" string looks like
      // before the ETL maps it, and what a hand-edited row could always be.
      const created = await repo.create(input(), ACTOR);
      await db
        .update(schema.purchaseOrders)
        .set({ termsTemplate: "Term-1" })
        .where(eq(schema.purchaseOrders.id, created.id));

      expect((await repo.findById(created.id)).termsTemplate).toBeNull();
    });
  });

  describe("delivery options", () => {
    it("offers the site's shipping address first, then its main address", async () => {
      const [only] = await db
        .insert(schema.sites)
        .values({
          name: "Hazira Yard",
          address: "Survey 118",
          area: "Hazira",
          pincode: "394270",
          shippingAddress: "Gate 3, Plot 9",
          shippingArea: "Mora",
          shippingPincode: "394517",
        })
        .returning({ id: schema.sites.id });

      const options = await repo.deliveryOptions(only!.id);

      expect(options.siteAddresses).toEqual([
        "Gate 3, Plot 9, Mora, 394517",
        "Survey 118, Hazira, 394270",
      ]);
    });

    it("offers one line when the two addresses are the same", async () => {
      const [same] = await db
        .insert(schema.sites)
        .values({ name: "One Address", address: "Plot 1", shippingAddress: "Plot 1" })
        .returning({ id: schema.sites.id });

      expect((await repo.deliveryOptions(same!.id)).siteAddresses).toEqual(["Plot 1"]);
    });

    it("skips the parts a site has not filled in rather than leaving gaps", async () => {
      // The source concatenates with no null handling and produces ", , Surat,".
      const [sparse] = await db
        .insert(schema.sites)
        .values({ name: "Sparse", address: "Plot 7" })
        .returning({ id: schema.sites.id });

      expect((await repo.deliveryOptions(sparse!.id)).siteAddresses).toEqual(["Plot 7"]);
    });

    it("offers nothing rather than an empty string when a site has no address", async () => {
      expect((await repo.deliveryOptions(siteId)).siteAddresses).toEqual([]);
    });

    it("lists the groups the site is in, with their addresses", async () => {
      const [group] = await db
        .insert(schema.siteGroups)
        .values({ name: "ROAD-GATE" })
        .returning({ id: schema.siteGroups.id });
      await db.insert(schema.siteGroupSites).values({ groupId: group!.id, siteId });
      await db.insert(schema.siteGroupAddresses).values([
        { groupId: group!.id, address: "Ward 3" },
        { groupId: group!.id, address: "Ward 1" },
      ]);

      const options = await repo.deliveryOptions(siteId);

      expect(options.groups).toHaveLength(1);
      expect(options.groups[0]!.name).toBe("ROAD-GATE");
      expect(options.groups[0]!.addresses).toEqual(["Ward 1", "Ward 3"]);
    });

    it("lists a group that has no addresses, because it is still a real group", async () => {
      const [group] = await db
        .insert(schema.siteGroups)
        .values({ name: "EMPTY" })
        .returning({ id: schema.siteGroups.id });
      await db.insert(schema.siteGroupSites).values({ groupId: group!.id, siteId });

      const options = await repo.deliveryOptions(siteId);
      expect(options.groups).toHaveLength(1);
      expect(options.groups[0]!.addresses).toEqual([]);
    });

    it("does not offer a group from another site", async () => {
      const [other] = await db
        .insert(schema.sites)
        .values({ name: "Elsewhere" })
        .returning({ id: schema.sites.id });
      const [group] = await db
        .insert(schema.siteGroups)
        .values({ name: "THEIRS" })
        .returning({ id: schema.siteGroups.id });
      await db.insert(schema.siteGroupSites).values({ groupId: group!.id, siteId: other!.id });

      expect((await repo.deliveryOptions(siteId)).groups).toEqual([]);
    });

    it("does not offer a deleted group", async () => {
      const [group] = await db
        .insert(schema.siteGroups)
        .values({ name: "GONE", isDeleted: true })
        .returning({ id: schema.siteGroups.id });
      await db.insert(schema.siteGroupSites).values({ groupId: group!.id, siteId });

      expect((await repo.deliveryOptions(siteId)).groups).toEqual([]);
    });

    it("refuses a site that does not exist", async () => {
      await expect(
        repo.deliveryOptions("99999999-9999-9999-9999-999999999999"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
