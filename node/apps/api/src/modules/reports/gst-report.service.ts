import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  GSTIN_PATTERN,
  normaliseGstin,
  type GstBillRow,
  type GstPaidRow,
  type GstRateRow,
  type GstReport,
  type GstReportQuery,
  type GstSupplierRow,
  type GstWarning,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { companies, purchaseInvoiceItems, purchaseInvoices, sites, suppliers } from "../../db/schema";
import { ReportsRepository } from "./reports.repository";
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
  private readonly ledger: ReportsRepository;

  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
    this.ledger = new ReportsRepository(database);
  }

  async report(query: GstReportQuery): Promise<GstReport> {
    const [byBill, paid] = await Promise.all([this.byBill(query), this.paidWise(query)]);
    return { ...byBill, ...paid };
  }

  /**
   * PAID-WISE (client, 26 Oct 2026): the payments made in the dates, and the GST
   * of the bills each one paid, in proportion. See `gstPaidRowSchema`.
   */
  private async paidWise(query: GstReportQuery): Promise<Pick<GstReport, "paid" | "paidTotals">> {
    const [{ entries, allocations }, allBills, siteRows, supplierRows, companyRows] = await Promise.all([
      this.ledger.settlementEntries(query.companyId),
      // Every bill's taxes, whatever its date: a payment in October may pay a bill of June.
      this.byBill({ companyId: query.companyId }),
      this.db.select({ id: sites.id, name: sites.name }).from(sites),
      this.db.select({ id: suppliers.id, name: suppliers.name, gstNo: suppliers.gstNo }).from(suppliers),
      this.db.select({ id: companies.id, name: companies.name }).from(companies),
    ]);

    // A bill's taxes, all its rates together.
    const taxesOf = new Map<string, Taxes>();
    for (const row of allBills.bills) {
      const t = taxesOf.get(row.invoiceId) ?? zero();
      add(t, { taxable: toPaise(row.taxable), cgst: toPaise(row.cgst), sgst: toPaise(row.sgst), igst: toPaise(row.igst) });
      taxesOf.set(row.invoiceId, t);
    }

    // The walk, one supplier, site and company at a time.
    interface Bill { key: string; id: string; displayNo: string; remaining: bigint; total: bigint }
    const groups = new Map<string, { bills: Bill[]; settlements: typeof entries }>();
    const billByKey = new Map<string, Bill>();
    for (const entry of entries) {
      const group = `${entry.partyId}|${entry.siteId ?? ""}|${entry.companyId}`;
      const into = groups.get(group) ?? { bills: [], settlements: [] };
      groups.set(group, into);
      if (entry.effect === "credit") {
        const bill: Bill = {
          key: `${entry.sourceKind}:${entry.documentId}`,
          id: entry.documentId,
          displayNo: entry.displayNo,
          remaining: toPaise(entry.amount),
          total: toPaise(entry.amount),
        };
        into.bills.push(bill);
        billByKey.set(bill.key, bill);
      } else {
        into.settlements.push(entry);
      }
    }
    const named = new Map<string, { bill: Bill; amount: bigint }[]>();
    for (const allocation of allocations) {
      const bill = billByKey.get(`${allocation.documentKind}:${allocation.documentId}`);
      if (!bill) continue;
      const list = named.get(allocation.paymentId) ?? [];
      list.push({ bill, amount: toPaise(allocation.amount) });
      named.set(allocation.paymentId, list);
    }

    /** What each payment paid, bill by bill. */
    const paidBy = new Map<string, { bill: Bill; amount: bigint }[]>();
    const unsettledOf = new Map<string, bigint>();
    for (const { bills, settlements } of groups.values()) {
      // What a payment names comes off those bills first, before anything is walked.
      for (const settlement of settlements) {
        for (const part of named.get(settlement.documentId) ?? []) {
          const take = part.amount < part.bill.remaining ? part.amount : part.bill.remaining;
          part.bill.remaining -= take;
          paidBy.set(settlement.documentId, [...(paidBy.get(settlement.documentId) ?? []), { bill: part.bill, amount: take }]);
        }
      }
      // The rest of each payment, and each return, pays the oldest bills.
      for (const settlement of settlements) {
        let left = toPaise(settlement.amount) - (named.get(settlement.documentId) ?? []).reduce((sum, part) => sum + part.amount, 0n);
        for (const bill of bills) {
          if (left <= 0n) break;
          if (bill.remaining <= 0n) continue;
          const take = left < bill.remaining ? left : bill.remaining;
          bill.remaining -= take;
          left -= take;
          paidBy.set(settlement.documentId, [...(paidBy.get(settlement.documentId) ?? []), { bill, amount: take }]);
        }
        unsettledOf.set(settlement.documentId, left > 0n ? left : 0n);
      }
    }

    const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
    const inDates = (iso: string | null) => {
      const d = day(iso);
      if (!d) return !query.fromDate && !query.toDate;
      return (!query.fromDate || d >= query.fromDate) && (!query.toDate || d <= query.toDate);
    };
    const siteName = new Map(siteRows.map((row) => [row.id, row.name]));
    const supplierOf = new Map(supplierRows.map((row) => [row.id, row]));
    const companyName = new Map(companyRows.map((row) => [row.id, row.name]));

    const paid: GstPaidRow[] = [];
    const total = zero();
    let amountTotal = 0n;
    let unsettledTotal = 0n;
    for (const entry of entries) {
      if (entry.sourceKind !== "payment" || !inDates(entry.documentDate)) continue;
      const share = zero();
      const billNos: string[] = [];
      for (const part of paidBy.get(entry.documentId) ?? []) {
        billNos.push(part.bill.displayNo);
        const taxes = taxesOf.get(part.bill.id);
        if (!taxes || part.bill.total === 0n) continue;
        // In proportion, rounded to the paisa.
        const of = (value: bigint) => (value * part.amount * 2n + part.bill.total) / (part.bill.total * 2n);
        add(share, { taxable: of(taxes.taxable), cgst: of(taxes.cgst), sgst: of(taxes.sgst), igst: of(taxes.igst) });
      }
      const supplier = supplierOf.get(entry.partyId);
      const unsettled = unsettledOf.get(entry.documentId) ?? 0n;
      paid.push({
        paymentId: entry.documentId,
        date: day(entry.documentDate),
        supplierId: entry.partyId,
        supplierName: supplier?.name ?? "",
        supplierGstin: normaliseGstin(supplier?.gstNo),
        companyName: companyName.get(entry.companyId) ?? "",
        siteName: entry.siteId ? (siteName.get(entry.siteId) ?? null) : null,
        referenceNo: entry.displayNo === "—" ? null : entry.displayNo,
        amount: fromPaise(toPaise(entry.amount)),
        billNos: [...new Set(billNos)],
        unsettled: fromPaise(unsettled),
        ...present(share),
      });
      add(total, share);
      amountTotal += toPaise(entry.amount);
      unsettledTotal += unsettled;
    }
    return {
      paid,
      paidTotals: { paymentCount: paid.length, amount: fromPaise(amountTotal), unsettled: fromPaise(unsettledTotal), ...present(total) },
    };
  }

  /** Bill by bill, supplier by supplier and rate by rate, by the bills' own dates. */
  private async byBill(query: GstReportQuery): Promise<Omit<GstReport, "paid" | "paidTotals">> {
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
