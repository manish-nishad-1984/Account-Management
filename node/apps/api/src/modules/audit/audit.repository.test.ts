import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import {
  auditQuerySchema,
  confirmPayoutListSchema,
  createPaymentSchema,
  createPayoutListSchema,
  createPurchaseInvoiceSchema,
  updatePaymentSchema,
  updatePurchaseInvoiceSchema,
} from "@accountmanagement/contracts";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";
import { AuditRepository } from "./audit.repository";
import { AuditController } from "./audit.controller";
import { PurchaseInvoicesRepository } from "../purchase-invoices/purchase-invoices.repository";
import { PaymentsRepository } from "../payments/payments.repository";
import { PayoutsRepository } from "../payouts/payouts.repository";
import { ReportsRepository } from "../reports/reports.repository";

/** The audit trail (client, 20 Oct 2026): who did what, when, and each old and new value. */
describe("the audit trail (real PostgreSQL)", () => {
  let db: Database;
  let audit: AuditRepository;
  let invoices: PurchaseInvoicesRepository;
  let payments: PaymentsRepository;
  let payouts: PayoutsRepository;
  let actorId: string;
  let supplierId: string;
  let companyId: string;
  let siteId: string;
  let unitId: number;

  const history = (entity: "purchase-invoice" | "payment" | "payout-list", entityId?: string, action?: string) =>
    audit.list(auditQuerySchema.parse({ entity, entityId, action }));

  const bill = (overrides: Record<string, unknown> = {}) =>
    invoices.create(
      createPurchaseInvoiceSchema.parse({
        supplierInvoiceNo: "BB/154",
        supplierId,
        companyId,
        siteId,
        documentDate: "2026-10-01",
        items: [{ itemName: "Cement", unitId, quantity: "10", unitPrice: "395.00", gstPercent: "18" }],
        ...overrides,
      }),
      actorId,
    );

  beforeEach(async () => {
    db = await freshDatabase();
    audit = new AuditRepository(db);
    invoices = new PurchaseInvoicesRepository(db);
    payments = new PaymentsRepository(db);
    payouts = new PayoutsRepository(db, new ReportsRepository(db));

    const [user] = await db
      .insert(schema.users)
      .values({ firstName: "Chintan", lastName: "K", email: "c@example.com", phoneNo: "1", userName: "chintan", password: "x" })
      .returning({ id: schema.users.id });
    actorId = user!.id;
    const [unit] = await db.insert(schema.units).values({ name: "Bag" }).returning({ id: schema.units.id });
    unitId = unit!.id;
    const [supplier] = await db.insert(schema.suppliers).values({ name: "SHAH ENTERPRISE" }).returning({ id: schema.suppliers.id });
    supplierId = supplier!.id;
    const [company] = await db.insert(schema.companies).values({ name: "DH PATEL", invoicePrefix: "DHP" }).returning({ id: schema.companies.id });
    companyId = company!.id;
    const [site] = await db.insert(schema.sites).values({ name: "SURAT", isActive: true }).returning({ id: schema.sites.id });
    siteId = site!.id;
  });

  it("records a purchase invoice made, changed field by field, approved and deleted - with who did it", async () => {
    const made = await bill();
    await invoices.update(
      made.id,
      updatePurchaseInvoiceSchema.parse({
        supplierInvoiceNo: "BB/155",
        items: [{ itemName: "Cement", unitId, quantity: "12", unitPrice: "395.00", gstPercent: "18" }],
      }),
      actorId,
    );
    await invoices.setApproval(made.id, true, actorId);
    await invoices.remove(made.id, actorId);

    const events = await history("purchase-invoice", made.id);
    expect(events.map((event) => event.action)).toEqual(["deleted", "approved", "updated", "created"]);
    expect(events.every((event) => event.actorName === "chintan")).toBe(true);

    const edit = events.find((event) => event.action === "updated")!;
    expect(edit.label).toBe("Bill BB/155 · SHAH ENTERPRISE");
    expect(edit.changes).toEqual(
      expect.arrayContaining([
        { field: "Bill no", from: "BB/154", to: "BB/155" },
        { field: "Line 1", from: "Cement · 10.000 Bag × 395.00 · GST 18.00% = 4661.00", to: "Cement · 12.000 Bag × 395.00 · GST 18.00% = 5593.20" },
        { field: "Total", from: "4661.00", to: "5593.00" },
      ]),
    );

    // The deleted invoice is kept as it read, lines and all.
    const [gone] = await history("purchase-invoice", undefined, "deleted");
    expect(gone!.entityId).toBe(made.id);
    expect(gone!.facts).toEqual(expect.arrayContaining([["Supplier", "SHAH ENTERPRISE"], ["Approved", "Yes"], ["Total", "5593.00"]]));
  });

  it("writes no event for a save that changes nothing", async () => {
    const made = await bill();
    await invoices.update(made.id, updatePurchaseInvoiceSchema.parse({ supplierInvoiceNo: "BB/154" }), actorId);
    expect((await history("purchase-invoice", made.id)).map((event) => event.action)).toEqual(["created"]);
  });

  it("records a payment's amount change and the bill it settles, cut with it", async () => {
    const made = await bill();
    await payments.createMany(
      [
        createPaymentSchema.parse({
          direction: "out",
          kind: "payment",
          partyId: supplierId,
          companyId,
          siteId,
          paymentDate: "2026-10-05",
          amount: "4661.00",
          allocations: [{ source: "invoice", documentId: made.id, amount: "4661.00" }],
        }),
      ],
      actorId,
    );
    const [payment] = await db.select({ id: schema.payments.id }).from(schema.payments);
    await payments.update(payment!.id, updatePaymentSchema.parse({ amount: "1000" }), actorId);
    await payments.remove(payment!.id, actorId);

    const events = await history("payment", payment!.id);
    expect(events.map((event) => event.action)).toEqual(["deleted", "updated", "created"]);
    expect(events[1]!.changes).toEqual([
      { field: "Amount", from: "4661.00", to: "1000.00" },
      { field: "Settles bill BB/154", from: "4661.00", to: "1000.00" },
    ]);
  });

  it("records a payout list confirmed and reversed, and the payments it made and took back", async () => {
    const made = await bill();
    const list = await payouts.create(
      createPayoutListSchema.parse({
        listDate: "2026-10-05",
        title: "Diwali",
        lines: [
          {
            partyId: supplierId,
            amount: "4661.00",
            invoices: [{ source: "invoice", documentId: made.id, displayNo: "BB/154", documentDate: "2026-10-01", siteName: "SURAT", amount: "4661.00", pending: "4661.00" }],
          },
        ],
      }),
      actorId,
    );
    await payouts.confirm(
      list.id,
      confirmPayoutListSchema.parse({
        paymentDate: "2026-10-06",
        method: "NEFT",
        lines: [{ partyId: supplierId, bills: [{ source: "invoice", documentId: made.id, paid: "4661.00" }] }],
      }),
      actorId,
    );
    await payouts.reverse(list.id, actorId);

    const events = await history("payout-list", list.id);
    expect(events.map((event) => event.action)).toEqual(["reversed", "confirmed", "created"]);
    expect(events[1]!.changes).toEqual(expect.arrayContaining([{ field: "Status", from: "Draft", to: "Confirmed" }]));

    const paid = await history("payment");
    expect(paid.map((event) => event.action)).toEqual(["deleted", "created"]);
  });

  it("shows a history only to someone who may see the record", async () => {
    const controller = new AuditController(audit);
    await expect(
      controller.list(auditQuerySchema.parse({ entity: "payment" }), { permissions: ["purchase-invoice.view"] } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.list(auditQuerySchema.parse({ entity: "payment" }), { permissions: ["reports-payments.view"] } as never),
    ).resolves.toEqual({ rows: [] });
  });
});
