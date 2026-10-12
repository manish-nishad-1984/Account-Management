import { z } from "zod";

/**
 * "Import locations" on Purchase Invoices (client, 12 Oct 2026): a spreadsheet
 * that says, invoice by invoice, which site location and shipping address each
 * one carries, applied to the invoices already entered.
 *
 * A row names its invoice by invoice number AND supplier — the same number can
 * stand under two suppliers. A blank location or shipping cell leaves that field
 * on the invoice as it is; the sheet never clears anything.
 */
export const PURCHASE_INVOICE_LOCATION_COLUMNS = [
  { key: "invoiceNo", header: "Invoice no", required: true },
  { key: "supplier", header: "Supplier", required: true },
  { key: "siteLocation", header: "Site location", required: false },
  { key: "shippingAddress", header: "Shipping address", required: false },
] as const;

export const PURCHASE_INVOICE_SHEET_MAX_ROWS = 20_000;
export const PURCHASE_INVOICE_SHEET_ACCEPT = ".xlsx";

export const purchaseInvoiceSheetResultSchema = z.object({
  rowCount: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  /** Spreadsheet row numbers, as Excel shows them. Any error means nothing was saved. */
  errors: z.array(
    z.object({
      row: z.number().int().nonnegative(),
      column: z.string().nullable(),
      message: z.string(),
    }),
  ),
});
export type PurchaseInvoiceSheetResult = z.infer<typeof purchaseInvoiceSheetResultSchema>;
