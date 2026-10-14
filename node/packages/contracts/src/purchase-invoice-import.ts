import { z } from "zod";

/**
 * "Import invoices" on Purchase Invoices (client, 14 Oct 2026): a month's
 * invoices, a hundred or so, keyed into one spreadsheet and brought in together.
 *
 * ONE ROW PER LINE. An invoice is the rows that share a supplier and an invoice
 * number; its header (date, company, site, charges...) is read from its first
 * row and may be repeated on the others, but may not CONTRADICT them.
 *
 * NOTHING IS TRUSTED, AND NOTHING IS SAVED UNTIL THE TOTALS HAVE BEEN LOOKED AT.
 * The server prices every invoice with the same arithmetic as the invoice form
 * (per-line rounding, then the whole-rupee rule with .50 rounding down), and
 * shows the result as a preview. The import is then only accepted for the same
 * file if the count and grand total the person verified still match.
 */
export const PURCHASE_INVOICE_IMPORT_COLUMNS = [
  { key: "invoiceNo", header: "Invoice no", required: true, note: "The supplier's number" },
  { key: "date", header: "Date", required: true, note: "dd-mm-yyyy" },
  { key: "supplier", header: "Supplier", required: true, note: "As in Suppliers" },
  { key: "company", header: "Company", required: true, note: "As in Companies" },
  { key: "site", header: "Site", required: true, note: "As in Sites" },
  { key: "siteLocation", header: "Site location", required: false, note: "A location of that site" },
  { key: "type", header: "Type", required: false, note: "Purchase (default), Purchase Return or Credit Note" },
  { key: "challanNo", header: "Challan no", required: false, note: "" },
  { key: "shippingAddress", header: "Location Address", required: false, note: "" },
  { key: "item", header: "Item", required: true, note: "As in Items" },
  { key: "unit", header: "Unit", required: false, note: "Blank takes the item's own unit" },
  { key: "quantity", header: "Quantity", required: true, note: "" },
  { key: "rate", header: "Rate", required: true, note: "Price per unit" },
  { key: "discount", header: "Discount per unit", required: false, note: "Rupees per unit, not a percentage" },
  { key: "discountPercent", header: "Discount %", required: false, note: "Percent of Rate, instead of Discount per unit" },
  { key: "gst", header: "GST %", required: false, note: "e.g. 18" },
  { key: "tds", header: "TDS", required: false, note: "Per invoice; subtracted" },
  { key: "adjustment", header: "Adjustment", required: false, note: "Per invoice; added, may be negative" },
  { key: "invoiceTotal", header: "Invoice total", required: false, note: "The figure on the paper bill, to check against" },
] as const;

export const PURCHASE_INVOICE_IMPORT_MAX_ROWS = 5_000;
export const PURCHASE_INVOICE_IMPORT_MAX_INVOICES = 500;
export const PURCHASE_INVOICE_IMPORT_ACCEPT = ".xlsx";

const errorSchema = z.object({
  /** The spreadsheet row, as Excel's gutter shows it. 1 is the heading row. */
  row: z.number().int().nonnegative(),
  column: z.string().nullable(),
  message: z.string(),
});

export const purchaseInvoiceImportInvoiceSchema = z.object({
  /** The first row of the invoice. */
  row: z.number().int().positive(),
  invoiceNo: z.string(),
  date: z.string().nullable(),
  supplier: z.string(),
  company: z.string(),
  site: z.string().nullable(),
  type: z.string(),
  lineCount: z.number().int().positive(),
  subtotal: z.string(),
  totalGst: z.string(),
  tds: z.string(),
  adjustment: z.string(),
  /** What the whole-rupee rule added or took off. */
  roundOff: z.string(),
  total: z.string(),
  /** The "Invoice total" the sheet gave, or null when it gave none. */
  sheetTotal: z.string().nullable(),
});
export type PurchaseInvoiceImportInvoice = z.infer<typeof purchaseInvoiceImportInvoiceSchema>;

export const purchaseInvoiceImportPreviewSchema = z.object({
  rowCount: z.number().int().nonnegative(),
  invoiceCount: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  invoices: z.array(purchaseInvoiceImportInvoiceSchema),
  totals: z.object({
    subtotal: z.string(),
    totalGst: z.string(),
    tds: z.string(),
    adjustment: z.string(),
    roundOff: z.string(),
    total: z.string(),
  }),
  /** Any error means the file cannot be imported; the totals above are then only what could be priced. */
  errors: z.array(errorSchema),
});
export type PurchaseInvoiceImportPreview = z.infer<typeof purchaseInvoiceImportPreviewSchema>;

export const purchaseInvoiceImportResultSchema = z.object({
  created: z.number().int().nonnegative(),
  total: z.string(),
});
export type PurchaseInvoiceImportResult = z.infer<typeof purchaseInvoiceImportResultSchema>;
