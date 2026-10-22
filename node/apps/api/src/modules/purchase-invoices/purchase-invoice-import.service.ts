import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import {
  INVOICE_TYPES,
  PURCHASE_INVOICE_IMPORT_COLUMNS,
  PURCHASE_INVOICE_IMPORT_MAX_INVOICES,
  PURCHASE_INVOICE_IMPORT_MAX_ROWS,
  createPurchaseInvoiceSchema,
  type CreatePurchaseInvoice,
  type PurchaseInvoiceImportInvoice,
  type PurchaseInvoiceImportPreview,
  type PurchaseInvoiceImportResult,
} from "@accountmanagement/contracts";
import { invoiceTotal, money } from "@accountmanagement/domain";

const { decimal, format, sum } = money;
import { DATABASE, type Database } from "../../db/database";
import { companies, items, purchaseInvoices, siteLocations, sites, suppliers, units } from "../../db/schema";
import { BaseRepository } from "../../common/base.repository";
import { SpreadsheetError, readWorkbook } from "../../common/spreadsheet/workbook";
import { PurchaseInvoicesRepository } from "./purchase-invoices.repository";

type Err = PurchaseInvoiceImportPreview["errors"][number];

/** Thrown when the file reads but cannot be imported; carries the whole preview, errors included. */
export class PurchaseInvoiceImportRejected extends Error {
  constructor(readonly preview: PurchaseInvoiceImportPreview) {
    super("The spreadsheet could not be imported.");
  }
}

type ColumnKey = (typeof PURCHASE_INVOICE_IMPORT_COLUMNS)[number]["key"];
type Raw = Record<ColumnKey, string> & { row: number };

/** Other ways a heading may be written, besides the one the sample file uses. */
const HEADING_ALIASES: Partial<Record<ColumnKey, string[]>> = {
  shippingAddress: ["shipping address"],
  discountPercent: ["discount in percentage", "discount percent", "discount percentage", "discount (%)", "discount in %"],
};

const norm = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();
const headerOf = (key: ColumnKey): string => PURCHASE_INVOICE_IMPORT_COLUMNS.find((c) => c.key === key)!.header;

/** A figure as typed in Excel: "₹ 1,23,456.50" and "18%" read as 123456.50 and 18. */
const figure = (text: string): string => text.replace(/[₹,%\s]/g, "");

/** "2024-25" for a date from 1 April 2024 to 31 March 2025; the date is `YYYY-MM-DD…`. */
const financialYearOf = (isoDate: string): string => {
  const year = Number(isoDate.slice(0, 4));
  const start = Number(isoDate.slice(5, 7)) >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

/** One bill: supplier, bill number, financial year and kind, as `billNoKey` in the schema reads them. */
const billKey = (supplierId: string, no: string, isoDate: string | null, invoiceType: string): string =>
  [
    supplierId,
    norm(no),
    isoDate ? financialYearOf(isoDate) : "no date",
    invoiceType === "Purchase Return" || invoiceType === "Credit Note" ? "return" : "bill",
  ].join("|");

/** Whether two figures are the same amount however they were typed (`5` and `5.00`). */
const sameFigure = (a: string, b: string): boolean => {
  const x = figure(a);
  const y = figure(b);
  return x === y || (x !== "" && y !== "" && Number(x) === Number(y));
};

/**
 * A date as `YYYY-MM-DD`, or null. Day first, as written in India: `05-10-2026`,
 * `5/10/2026`, `05.10.2026`. A year-first date is accepted as the sheet's own
 * Excel dates arrive that way. Impossible dates (31-02) are refused, not rolled over.
 */
function parseDate(text: string): string | null {
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (hit) {
    [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  } else if ((hit = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text))) {
    [d, m, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  } else {
    return null;
  }
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Brings a month's purchase invoices in from a spreadsheet (client, 14 Oct 2026).
 *
 * Two steps over the SAME file. `preview` prices every invoice with the
 * invoice form's own arithmetic and reports every problem; `import` does that
 * again and saves only when there are no problems AND the invoice count and grand
 * total are the ones the person verified. All or nothing.
 */
@Injectable()
export class PurchaseInvoiceImportService extends BaseRepository {
  constructor(
    @Inject(DATABASE) database: Database | null,
    private readonly invoices: PurchaseInvoicesRepository,
  ) {
    super(database);
  }

  async preview(bytes: Buffer): Promise<PurchaseInvoiceImportPreview> {
    return (await this.analyse(bytes)).preview;
  }

  async import(
    bytes: Buffer,
    actorId: string,
    isApproved: boolean,
    verified: { count: number; total: string },
  ): Promise<PurchaseInvoiceImportResult> {
    const { preview, inputs } = await this.analyse(bytes);
    if (preview.errors.length > 0) {
      throw new PurchaseInvoiceImportRejected(preview);
    }
    if (preview.invoiceCount !== verified.count || !sameFigure(preview.totals.total, verified.total)) {
      throw new BadRequestException(
        `This file is not the one that was checked: it holds ${preview.invoiceCount} invoices totalling ` +
          `${preview.totals.total}, not ${verified.count} totalling ${verified.total}. Check the file again.`,
      );
    }
    await this.invoices.createMany(
      inputs.map((input) => ({ ...input, isApproved })),
      actorId,
    );
    return { created: inputs.length, total: preview.totals.total };
  }

  private async analyse(
    bytes: Buffer,
  ): Promise<{ preview: PurchaseInvoiceImportPreview; inputs: CreatePurchaseInvoice[] }> {
    let sheet;
    try {
      sheet = await readWorkbook(bytes, PURCHASE_INVOICE_IMPORT_MAX_ROWS);
    } catch (error) {
      throw new BadRequestException(
        error instanceof SpreadsheetError ? error.message : "The file could not be read.",
      );
    }

    const emptyTotals = { subtotal: "0.00", totalGst: "0.00", tds: "0.00", adjustment: "0.00", roundOff: "0.00", total: "0.00" };
    const reject = (errors: Err[]) =>
      ({ preview: { rowCount: sheet.rows.length, invoiceCount: 0, lineCount: 0, invoices: [], totals: emptyTotals, errors }, inputs: [] });

    // ---- headings -------------------------------------------------------------
    const at = new Map<string, number>();
    sheet.header.forEach((name, i) => at.set(norm(name), i));
    const index = {} as Record<ColumnKey, number | undefined>;
    for (const c of PURCHASE_INVOICE_IMPORT_COLUMNS) {
      index[c.key] = at.get(norm(c.header)) ?? HEADING_ALIASES[c.key]?.map((alias) => at.get(alias)).find((i) => i !== undefined);
    }
    const missing = PURCHASE_INVOICE_IMPORT_COLUMNS.filter((c) => c.required && index[c.key] === undefined);
    if (missing.length > 0) {
      return reject(missing.map((c) => ({ row: 1, column: c.header, message: `The column "${c.header}" is missing.` })));
    }

    const raws: Raw[] = sheet.rows.map((row) => {
      const raw = { row: row.number } as Raw;
      for (const c of PURCHASE_INVOICE_IMPORT_COLUMNS) {
        const i = index[c.key];
        raw[c.key] = i === undefined ? "" : (row.cells[i] ?? "");
      }
      return raw;
    });

    const errors: Err[] = [];
    const err = (row: number, key: ColumnKey | null, message: string) =>
      errors.push({ row, column: key ? headerOf(key) : null, message });

    // ---- group the rows into invoices ----------------------------------------
    const groups = new Map<string, Raw[]>();
    for (const raw of raws) {
      if (!raw.invoiceNo) err(raw.row, "invoiceNo", "Invoice no is required.");
      if (!raw.supplier) err(raw.row, "supplier", "Supplier is required.");
      if (!raw.invoiceNo || !raw.supplier) continue;
      const key = `${norm(raw.supplier)}|${norm(raw.invoiceNo)}`;
      groups.set(key, [...(groups.get(key) ?? []), raw]);
    }
    if (groups.size > PURCHASE_INVOICE_IMPORT_MAX_INVOICES) {
      return reject([{ row: 0, column: null, message: `A file may hold at most ${PURCHASE_INVOICE_IMPORT_MAX_INVOICES} invoices; this one has ${groups.size}. Split it.` }]);
    }

    // ---- what the names can mean ---------------------------------------------
    const [supplierRows, companyRows, siteRows, locationRows, itemRows, unitRows] = await Promise.all([
      this.db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.isDeleted, false)),
      this.db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.isDeleted, false)),
      this.db.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.isDeleted, false)),
      this.db.select({ id: siteLocations.id, siteId: siteLocations.siteId, name: siteLocations.name, address: siteLocations.address }).from(siteLocations).where(eq(siteLocations.isDeleted, false)),
      this.db.select({ id: items.id, name: items.name, unitId: items.unitId }).from(items).where(eq(items.isDeleted, false)),
      this.db.select({ id: units.id, name: units.name }).from(units),
    ]);
    const byName = <T extends { name: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) map.set(norm(row.name), [...(map.get(norm(row.name)) ?? []), row]);
      return map;
    };
    const supplierBy = byName(supplierRows);
    const companyBy = byName(companyRows);
    const siteBy = byName(siteRows);
    const itemBy = byName(itemRows);
    const unitBy = byName(unitRows);

    /** One match, or an error saying why not. */
    const one = <T extends { name: string }>(
      map: Map<string, T[]>,
      text: string,
      row: number,
      key: ColumnKey,
      what: string,
    ): T | null => {
      const found = map.get(norm(text)) ?? [];
      if (found.length === 1) return found[0]!;
      err(row, key, found.length === 0 ? `${what} "${text}" was not found.` : `${found.length} ${what.toLowerCase()}s are named "${text}"; it cannot tell which.`);
      return null;
    };

    // ---- invoices already saved ----------------------------------------------
    const supplierIds = [...new Set(supplierRows.map((s) => s.id))];
    const existing = supplierIds.length
      ? await this.db
          .select({
            supplierId: purchaseInvoices.supplierId,
            no: purchaseInvoices.supplierInvoiceNo,
            invoiceNo: purchaseInvoices.invoiceNo,
            documentDate: purchaseInvoices.documentDate,
            invoiceType: purchaseInvoices.invoiceType,
          })
          .from(purchaseInvoices)
          .where(and(inArray(purchaseInvoices.supplierId, supplierIds)))
      : [];
    // The rule the invoice form and the database hold (`billNoKey` in the schema):
    // one supplier, bill number, financial year and kind is one bill.
    const savedBill = new Map(
      existing.map((e) => [
        billKey(e.supplierId, e.no ?? "", e.documentDate ? new Date(e.documentDate).toISOString() : null, e.invoiceType),
        e,
      ]),
    );

    // ---- each invoice ---------------------------------------------------------
    const summaries: PurchaseInvoiceImportInvoice[] = [];
    const inputs: CreatePurchaseInvoice[] = [];
    let lineCount = 0;

    for (const rows of groups.values()) {
      const first = rows[0]!;
      const before = errors.length;

      /** The value the invoice's rows agree on; a row that disagrees is an error. */
      const header = (key: ColumnKey, same: (a: string, b: string) => boolean = (a, b) => norm(a) === norm(b)): string => {
        let value = "";
        for (const r of rows) {
          const v = r[key];
          if (v === "") continue;
          if (value === "") value = v;
          else if (!same(value, v)) err(r.row, key, `${headerOf(key)} is "${v}" here but "${value}" on an earlier row of the same invoice.`);
        }
        return value;
      };

      const dateText = header("date");
      const supplier = one(supplierBy, first.supplier, first.row, "supplier", "Supplier");
      const companyText = header("company");
      const siteText = header("site");
      const locationText = header("siteLocation");
      const typeText = header("type");
      const tdsText = header("tds", sameFigure);
      const adjustmentText = header("adjustment", sameFigure);
      const sheetTotalText = header("invoiceTotal", sameFigure);
      const challanNo = header("challanNo");
      const shipping = header("shippingAddress");

      const company = companyText ? one(companyBy, companyText, first.row, "company", "Company") : (err(first.row, "company", "Company is required."), null);
      const site = siteText ? one(siteBy, siteText, first.row, "site", "Site") : (err(first.row, "site", "Site is required."), null);

      let siteLocationId: string | null = null;
      // LOCATION ADDRESS BLANK: the location's own address, as the form fills it
      // when a location is picked (client, 22 Oct 2026).
      let shippingAddress = shipping;
      if (locationText && site) {
        const hit = locationRows.filter((l) => l.siteId === site.id && norm(l.name) === norm(locationText));
        if (hit.length === 1) {
          siteLocationId = hit[0]!.id;
          if (!shippingAddress) shippingAddress = hit[0]!.address?.trim() ?? "";
        }
        else err(first.row, "siteLocation", hit.length === 0 ? `"${locationText}" is not a location of site "${site.name}".` : `Site "${site.name}" has ${hit.length} locations named "${locationText}".`);
      }

      let invoiceType: (typeof INVOICE_TYPES)[number] = "Purchase";
      if (typeText) {
        const t = INVOICE_TYPES.find((x) => norm(x) === norm(typeText));
        if (t) invoiceType = t;
        else err(first.row, "type", `Type "${typeText}" is not one of ${INVOICE_TYPES.join(", ")}.`);
      }

      let documentDate: string | null = null;
      if (!dateText) err(first.row, "date", "Date is required.");
      else {
        documentDate = parseDate(dateText);
        if (!documentDate) err(first.row, "date", `"${dateText}" is not a date. Write it as dd-mm-yyyy.`);
      }

      const already = supplier && documentDate ? savedBill.get(billKey(supplier.id, first.invoiceNo, documentDate, invoiceType)) : undefined;
      if (supplier && already) {
        err(
          first.row,
          "invoiceNo",
          `Bill "${first.invoiceNo}" of "${supplier.name}" is already entered in ${financialYearOf(documentDate!)} ` +
            `(our no. ${already.invoiceNo ?? "—"}). Importing it again would double it.`,
        );
      }

      /**
       * The discount of a line in RUPEES PER UNIT, the one form an invoice stores.
       *
       * "Discount %" is a percent of the Rate, turned into rupees per unit and
       * rounded to the paise the invoice keeps (half up), which is exactly what
       * typing that rupee figure on the form would give. Giving both columns on a
       * line is refused: which one counts would be a guess.
       */
      const discountPerUnitOf = (r: Raw): string => {
        const rupees = figure(r.discount);
        const percent = figure(r.discountPercent);
        if (percent === "") return rupees;
        if (rupees !== "" && Number(rupees) !== 0) {
          err(r.row, "discountPercent", "Give Discount per unit or Discount %, not both.");
          return rupees;
        }
        if (!/^\d{1,3}(\.\d{1,2})?$/.test(percent) || Number(percent) > 100) {
          err(r.row, "discountPercent", `"${r.discountPercent}" is not a percentage between 0 and 100 (at most 2 decimals).`);
          return "";
        }
        const rate = figure(r.rate);
        // A rate that is not an amount is reported by its own column.
        if (!/^\d{1,15}(\.\d{1,2})?$/.test(rate)) return "";
        return format(money.round(money.percentOf(decimal(percent), decimal(rate))));
      };

      // The lines.
      const lines = rows.map((r) => {
        let itemId: string | null = null;
        let unitId: number | null = null;
        if (!r.item) err(r.row, "item", "Item is required.");
        else {
          const item = one(itemBy, r.item, r.row, "item", "Item");
          if (item) {
            itemId = item.id;
            unitId = item.unitId;
          }
        }
        if (r.unit) {
          const unit = one(unitBy, r.unit, r.row, "unit", "Unit");
          if (unit) unitId = unit.id;
        }
        return {
          itemId,
          unitId: unitId ?? 0,
          quantity: figure(r.quantity),
          unitPrice: figure(r.rate),
          discountPerUnit: discountPerUnitOf(r),
          gstPercent: figure(r.gst),
        };
      });
      lineCount += lines.length;

      const candidate = {
        supplierInvoiceNo: first.invoiceNo,
        invoiceType,
        supplierId: supplier?.id,
        companyId: company?.id,
        siteId: site?.id ?? null,
        siteLocationId,
        documentDate: documentDate ? `${documentDate}T00:00:00.000Z` : null,
        challanNo,
        shippingAddress,
        tds: figure(tdsText),
        roundOff: figure(adjustmentText),
        items: lines,
      };

      // The same rules as the invoice form, line by line.
      const parsed = createPurchaseInvoiceSchema.safeParse(candidate);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const [head, n, field] = issue.path;
          const row = head === "items" && typeof n === "number" ? (rows[n]?.row ?? first.row) : first.row;
          const key: ColumnKey | null =
            head === "items"
              ? field === "quantity" ? "quantity" : field === "unitPrice" ? "rate" : field === "discountPerUnit" ? "discount" : field === "gstPercent" ? "gst" : field === "unitId" ? "unit" : "item"
              : head === "tds" ? "tds" : head === "roundOff" ? "adjustment" : head === "documentDate" ? "date" : head === "supplierId" || head === "companyId" ? null : null;
          // Names that did not resolve have already been reported.
          if ((head === "supplierId" || head === "companyId") || (head === "items" && (field === "itemId" || field === "unitId") && errors.some((e) => e.row === row))) continue;
          err(row, key, issue.message);
        }
      }

      if (errors.length > before || !parsed.success) continue;

      // Price it exactly as the form does.
      const priced = invoiceTotal.corrected(
        parsed.data.items.map((l) => ({
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          discountPerUnit: l.discountPerUnit ?? undefined,
          gstPercent: l.gstPercent ?? undefined,
        })),
        { tds: parsed.data.tds ?? undefined, roundOff: parsed.data.roundOff ?? undefined },
      );

      if (sheetTotalText && !sameFigure(format(decimal(figure(sheetTotalText))), priced.grandTotal)) {
        const difference = format(decimal(priced.grandTotal) - decimal(figure(sheetTotalText)));
        err(
          first.row,
          "invoiceTotal",
          `The sheet says ${format(decimal(figure(sheetTotalText)))} but the lines come to ${priced.grandTotal} (${difference} apart). ` +
            `Check the rates, GST % and discounts, or put the difference in Adjustment.`,
        );
        continue;
      }

      inputs.push(parsed.data);
      summaries.push({
        row: first.row,
        invoiceNo: first.invoiceNo,
        date: documentDate,
        supplier: supplier!.name,
        company: company!.name,
        site: site?.name ?? null,
        type: invoiceType,
        lineCount: lines.length,
        subtotal: priced.subtotal,
        totalGst: priced.totalGst,
        tds: priced.tds,
        adjustment: priced.roundOff,
        roundOff: priced.autoRoundOff,
        total: priced.grandTotal,
        sheetTotal: sheetTotalText ? format(decimal(figure(sheetTotalText))) : null,
      });
    }

    const column = (pick: (i: PurchaseInvoiceImportInvoice) => string) => format(sum(summaries.map((i) => decimal(pick(i)))));
    errors.sort((a, b) => a.row - b.row);

    return {
      preview: {
        rowCount: raws.length,
        invoiceCount: summaries.length,
        lineCount,
        invoices: summaries,
        totals: {
          subtotal: column((i) => i.subtotal),
          totalGst: column((i) => i.totalGst),
          tds: column((i) => i.tds),
          adjustment: column((i) => i.adjustment),
          roundOff: column((i) => i.roundOff),
          total: column((i) => i.total),
        },
        errors,
      },
      inputs,
    };
  }
}
