import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  PURCHASE_INVOICE_LOCATION_COLUMNS,
  PURCHASE_INVOICE_SHEET_MAX_ROWS,
  type PurchaseInvoiceSheetResult,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { purchaseInvoices, siteLocations, suppliers } from "../../db/schema";
import { BaseRepository, updatedBy } from "../../common/base.repository";
import { SpreadsheetError, readWorkbook } from "../../common/spreadsheet/workbook";

type SheetError = PurchaseInvoiceSheetResult["errors"][number];

/** Thrown when the file reads but cannot be applied; carries every problem. */
export class PurchaseInvoiceSheetRejected extends Error {
  constructor(readonly result: PurchaseInvoiceSheetResult) {
    super("The spreadsheet could not be imported.");
  }
}

const SHIPPING_MAX = 500;
const norm = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Sets the site location and shipping address of existing purchase invoices
 * from a spreadsheet (client, 12 Oct 2026).
 *
 * ALL OR NOTHING, and every problem is reported at once, as the item import
 * does: validate every row first, write only when there are none. A blank
 * location or shipping cell leaves that field as it is.
 */
@Injectable()
export class PurchaseInvoiceLocationSheetService extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  async import(bytes: Buffer, actorId: string): Promise<PurchaseInvoiceSheetResult> {
    let sheet;
    try {
      sheet = await readWorkbook(bytes, PURCHASE_INVOICE_SHEET_MAX_ROWS);
    } catch (error) {
      throw new BadRequestException(
        error instanceof SpreadsheetError ? error.message : "The file could not be read.",
      );
    }

    const at = new Map<string, number>();
    sheet.header.forEach((name, i) => at.set(norm(name), i));
    const col = Object.fromEntries(
      PURCHASE_INVOICE_LOCATION_COLUMNS.map((c) => [c.key, at.get(norm(c.header))]),
    ) as Record<(typeof PURCHASE_INVOICE_LOCATION_COLUMNS)[number]["key"], number | undefined>;

    const headerErrors: SheetError[] = PURCHASE_INVOICE_LOCATION_COLUMNS.filter(
      (c) => c.required && col[c.key] === undefined,
    ).map((c) => ({ row: 1, column: c.header, message: `The column "${c.header}" is missing.` }));
    if (col.siteLocation === undefined && col.shippingAddress === undefined) {
      headerErrors.push({
        row: 1,
        column: null,
        message: 'Add a "Site location" or a "Shipping address" column, or there is nothing to apply.',
      });
    }
    if (headerErrors.length > 0) {
      throw new PurchaseInvoiceSheetRejected({ rowCount: sheet.rows.length, updated: 0, errors: headerErrors });
    }

    const cell = (cells: string[], index: number | undefined) => (index === undefined ? "" : (cells[index] ?? ""));
    const wanted = sheet.rows.map((row) => ({
      number: row.number,
      invoiceNo: cell(row.cells, col.invoiceNo),
      supplier: cell(row.cells, col.supplier),
      location: cell(row.cells, col.siteLocation),
      shipping: cell(row.cells, col.shippingAddress),
    }));

    const errors: SheetError[] = [];
    const numbers = [...new Set(wanted.map((w) => norm(w.invoiceNo)).filter(Boolean))];
    const NO = sql<string>`lower(regexp_replace(btrim(coalesce(nullif(btrim(${purchaseInvoices.supplierInvoiceNo}), ''), ${purchaseInvoices.invoiceNo})), '\s+', ' ', 'g'))`;
    const invoices =
      numbers.length === 0
        ? []
        : await this.db
            .select({
              id: purchaseInvoices.id,
              no: NO,
              supplier: suppliers.name,
              siteId: purchaseInvoices.siteId,
            })
            .from(purchaseInvoices)
            .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
            .where(inArray(NO, numbers));

    const siteIds = [...new Set(invoices.map((i) => i.siteId).filter((s): s is string => !!s))];
    const locations =
      siteIds.length === 0
        ? []
        : await this.db
            .select({ id: siteLocations.id, siteId: siteLocations.siteId, name: siteLocations.name })
            .from(siteLocations)
            .where(and(inArray(siteLocations.siteId, siteIds), eq(siteLocations.isDeleted, false)));

    const patches = new Map<string, { siteLocationId?: string; shippingAddress?: string }>();
    for (const w of wanted) {
      if (!w.invoiceNo) errors.push({ row: w.number, column: "Invoice no", message: "Invoice no is required." });
      if (!w.supplier) errors.push({ row: w.number, column: "Supplier", message: "Supplier is required." });
      if (!w.invoiceNo || !w.supplier) continue;
      if (!w.location && !w.shipping) continue;
      if (w.shipping.length > SHIPPING_MAX) {
        errors.push({
          row: w.number,
          column: "Shipping address",
          message: `Shipping address is longer than ${SHIPPING_MAX} characters.`,
        });
        continue;
      }

      const found = invoices.filter((i) => i.no === norm(w.invoiceNo) && norm(i.supplier) === norm(w.supplier));
      if (found.length === 0) {
        errors.push({ row: w.number, column: null, message: `No purchase invoice "${w.invoiceNo}" for supplier "${w.supplier}".` });
        continue;
      }
      if (found.length > 1) {
        errors.push({ row: w.number, column: null, message: `${found.length} invoices have number "${w.invoiceNo}" for "${w.supplier}", so this row cannot tell which one.` });
        continue;
      }
      const invoice = found[0]!;
      if (patches.has(invoice.id)) {
        errors.push({ row: w.number, column: null, message: `Invoice "${w.invoiceNo}" of "${w.supplier}" is on an earlier row too.` });
        continue;
      }

      const patch: { siteLocationId?: string; shippingAddress?: string } = {};
      if (w.location) {
        const match = invoice.siteId
          ? locations.find((l) => l.siteId === invoice.siteId && norm(l.name) === norm(w.location))
          : undefined;
        if (!match) {
          errors.push({
            row: w.number,
            column: "Site location",
            message: invoice.siteId
              ? `"${w.location}" is not a location of this invoice's site.`
              : "This invoice has no site, so it cannot take a location.",
          });
          continue;
        }
        patch.siteLocationId = match.id;
      }
      if (w.shipping) patch.shippingAddress = w.shipping;
      patches.set(invoice.id, patch);
    }

    if (errors.length > 0) {
      throw new PurchaseInvoiceSheetRejected({ rowCount: wanted.length, updated: 0, errors });
    }

    await this.db.transaction(async (tx) => {
      for (const [id, patch] of patches) {
        await tx
          .update(purchaseInvoices)
          .set({ ...patch, ...updatedBy(actorId) })
          .where(eq(purchaseInvoices.id, id));
      }
    });

    return { rowCount: wanted.length, updated: patches.size, errors: [] };
  }
}
