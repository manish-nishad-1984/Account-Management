import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  GSTIN_PATTERN,
  normaliseGstin,
  type GstBillRow,
  type GstRateRow,
  type GstReport,
  type GstReportQuery,
  type GstSupplierRow,
  type GstWarning,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { companies, purchaseInvoiceItems, purchaseInvoices, suppliers } from "../../db/schema";
import { BaseRepository } from "../../common/base.repository";
import { dateRangeWhere } from "../../common/date-range";
import { fromPaise, toPaise } from "../balance-sheet/balance-sheet.service";

/** These reduce what is owed, so they reduce the input tax too. */
const NEGATIVE_TYPES = new Set(["Purchase Return", "Credit Note"]);

interface Taxes {
  taxable: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
}
const zero = (): Taxes => ({ taxable: 0n, cgst: 0n, sgst: 0n, igst: 0n });
const add = (into: Taxes, from: Taxes) => {
  into.taxable += from.taxable;
  into.cgst += from.cgst;
  into.sgst += from.sgst;
  into.igst += from.igst;
};
const present = (t: Taxes) => ({
  taxable: fromPaise(t.taxable),
  cgst: fromPaise(t.cgst),
  sgst: fromPaise(t.sgst),
  igst: fromPaise(t.igst),
  totalGst: fromPaise(t.cgst + t.sgst + t.igst),
});

/**
 * Same state: CGST and SGST, half each; an odd paisa goes to CGST, so the two
 * always add back to the GST on the bill. A different state: all IGST.
 */
export function splitGst(gst: bigint, interState: boolean): Pick<Taxes, "cgst" | "sgst" | "igst"> {
  if (interState) return { cgst: 0n, sgst: 0n, igst: gst };
  const negative = gst < 0n;
  const whole = negative ? -gst : gst;
  const cgst = (whole + 1n) / 2n;
  const sgst = whole - cgst;
  return negative ? { cgst: -cgst, sgst: -sgst, igst: 0n } : { cgst, sgst, igst: 0n };
}

const stateOf = (gstin: string | null): string | null => (gstin && GSTIN_PATTERN.test(gstin) ? gstin.slice(0, 2) : null);

/** The month's input GST from the purchase invoices (client, 22 Oct 2026). See `contracts/gst-report.ts`. */
@Injectable()
export class GstReportService extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  async report(query: GstReportQuery): Promise<GstReport> {
    const where = [
      ...dateRangeWhere({ document: purchaseInvoices.documentDate, entry: purchaseInvoices.createdAt }, query),
      ...(query.companyId ? [eq(purchaseInvoices.companyId, query.companyId)] : []),
    ];

    const rows = await this.db
      .select({
        invoiceId: purchaseInvoices.id,
        billNo: purchaseInvoices.supplierInvoiceNo,
        ourNo: purchaseInvoices.invoiceNo,
        date: sql<string | null>`to_char(${purchaseInvoices.documentDate} at time zone 'UTC', 'YYYY-MM-DD')`,
        invoiceType: purchaseInvoices.invoiceType,
        supplierId: suppliers.id,
        supplierName: suppliers.name,
        supplierGstin: suppliers.gstNo,
        companyName: companies.name,
        companyGstin: companies.gstNo,
        gstPercent: sql<string>`coalesce(${purchaseInvoiceItems.gstPercent}, 0)::text`,
        taxable: sql<string>`sum(${purchaseInvoiceItems.netAmount})::text`,
        gst: sql<string>`sum(${purchaseInvoiceItems.gstAmount})::text`,
      })
      .from(purchaseInvoices)
      .innerJoin(purchaseInvoiceItems, eq(purchaseInvoiceItems.purchaseInvoiceId, purchaseInvoices.id))
      .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
      .innerJoin(companies, eq(companies.id, purchaseInvoices.companyId))
      .where(where.length > 0 ? and(...where) : undefined)
      .groupBy(purchaseInvoices.id, suppliers.id, companies.id, sql`coalesce(${purchaseInvoiceItems.gstPercent}, 0)`)
      .orderBy(asc(purchaseInvoices.documentDate), asc(purchaseInvoices.supplierInvoiceNo), sql`coalesce(${purchaseInvoiceItems.gstPercent}, 0)`);

    const bills: GstBillRow[] = [];
    const bySupplier = new Map<string, { row: Omit<GstSupplierRow, keyof ReturnType<typeof present>>; taxes: Taxes; bills: Set<string> }>();
    const byRate = new Map<string, Taxes>();
    const total = zero();
    const allBills = new Set<string>();
    const warned = new Map<string, GstWarning & { bills: Set<string> }>();

    const warn = (key: string, warning: Omit<GstWarning, "billCount">, invoiceId: string) => {
      const entry = warned.get(key) ?? { ...warning, billCount: 0, bills: new Set<string>() };
      entry.bills.add(invoiceId);
      warned.set(key, entry);
    };

    for (const row of rows) {
      const supplierGstin = normaliseGstin(row.supplierGstin);
      const companyGstin = normaliseGstin(row.companyGstin);
      const supplierState = stateOf(supplierGstin);
      const companyState = stateOf(companyGstin);
      if (!supplierGstin) warn(`s-missing-${row.supplierId}`, { problem: "supplier-gstin-missing", name: row.supplierName, gstin: null }, row.invoiceId);
      else if (!supplierState) warn(`s-invalid-${row.supplierId}`, { problem: "supplier-gstin-invalid", name: row.supplierName, gstin: supplierGstin }, row.invoiceId);
      if (!companyState) warn(`c-${row.companyName}`, { problem: "company-gstin-missing", name: row.companyName, gstin: companyGstin }, row.invoiceId);

      // Not placed without both states; counted as within the state, and warned above.
      const interState = supplierState !== null && companyState !== null && supplierState !== companyState;
      const sign = NEGATIVE_TYPES.has(row.invoiceType ?? "") ? -1n : 1n;
      const taxes: Taxes = { taxable: sign * toPaise(row.taxable), ...splitGst(sign * toPaise(row.gst), interState) };

      bills.push({
        invoiceId: row.invoiceId,
        billNo: row.billNo ?? "",
        ourNo: row.ourNo,
        date: row.date,
        invoiceType: row.invoiceType ?? "Purchase",
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        supplierGstin,
        companyName: row.companyName,
        companyGstin,
        gstPercent: Number(row.gstPercent).toFixed(2),
        interState,
        ...present(taxes),
      });

      const supplier = bySupplier.get(row.supplierId) ?? {
        row: { supplierId: row.supplierId, supplierName: row.supplierName, supplierGstin, billCount: 0 },
        taxes: zero(),
        bills: new Set<string>(),
      };
      add(supplier.taxes, taxes);
      supplier.bills.add(row.invoiceId);
      bySupplier.set(row.supplierId, supplier);

      const rate = Number(row.gstPercent).toFixed(2);
      const rateTaxes = byRate.get(rate) ?? zero();
      add(rateTaxes, taxes);
      byRate.set(rate, rateTaxes);

      add(total, taxes);
      allBills.add(row.invoiceId);
    }

    return {
      bills,
      suppliers: [...bySupplier.values()]
        .map(({ row, taxes, bills: ids }) => ({ ...row, billCount: ids.size, ...present(taxes) }))
        .sort((a, b) => a.supplierName.localeCompare(b.supplierName)),
      rates: [...byRate.entries()]
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([gstPercent, taxes]): GstRateRow => ({ gstPercent, ...present(taxes) })),
      totals: { billCount: allBills.size, ...present(total) },
      warnings: [...warned.values()].map(({ bills: ids, ...warning }) => ({ ...warning, billCount: ids.size })),
    };
  }
}
