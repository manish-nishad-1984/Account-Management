import { z } from "zod";

/**
 * Item price history — the clock icon in the Item Master's Action column.
 *
 * WHAT THIS SCREEN IS, AND WHAT IT IS NOT
 *
 * It is NOT an audit log of `items.price_per_unit`. PLAN.md said it was until
 * 8 Sep 2026, inferred from a screenshot of a clock icon, and reading the query
 * is what corrected it. `ItemMasterRepo.GetItemHistory` (line 581) returns a
 * `SupplierInvoiceList`: it joins `SupplierInvoices` to `SupplierInvoiceDetails`
 * for one `ItemId` and lists every supplier invoice LINE for that item.
 * `_ItemHistoryPartial.cshtml` renders
 * `InvoiceNo | Supplier | Site | Date | Price | GST | PriceWithGST`, and its
 * empty state is literally "No invoices found."
 *
 * So this is a PURCHASE-price history — what was actually paid for the item,
 * per invoice — over `purchase_invoices` and `purchase_invoice_items`. There is
 * no modelling decision behind it and nothing to store: it is a query and a
 * panel.
 *
 * FOUR DEFECTS IN THE SOURCE'S SEVEN COLUMNS, ALL DEPARTED FROM. Each is
 * recorded on the field it affects below.
 */

/** One purchase invoice LINE for the item, newest document first. */
export const itemPriceHistoryRowSchema = z.object({
  /** The line's own id, so React has a key that survives two lines of one invoice. */
  id: z.string(),

  invoiceId: z.string(),

  /**
   * The invoice's number as the list screen shows it — the supplier's own,
   * falling back to ours.
   *
   * DEFECT 1, not reproduced. The legacy partial's column header says
   * `InvoiceNo` and its cell renders `@item.SupplierInvoiceNo`, so the two
   * disagree; and when the supplier number is null the cell is blank with
   * nothing to click. `displayNo` is the same expression the purchase invoice
   * list uses, so the number here and the number there are always the same
   * string.
   */
  displayNo: z.string(),

  /**
   * `Purchase`, `Purchase Return` or `Credit Note`.
   *
   * ADDED, not in the legacy panel. The legacy query excludes only rows whose
   * `InvoiceNo` is the literal `"PayOut"`, so purchase returns and credit notes
   * have always appeared in this history — unlabelled, looking exactly like a
   * purchase. A return at a different price then reads as a price that was paid.
   * Carried so the panel can mark it; nothing is filtered out that the source
   * showed.
   */
  invoiceType: z.string(),

  supplierId: z.string(),
  supplierName: z.string(),

  /**
   * NULLABLE, where the legacy query INNER JOINs `Sites`.
   *
   * `purchase_invoices.site_id` is nullable here, so an inner join would drop
   * every invoice raised without a site — silently, and from a history whose
   * whole purpose is completeness. Same decision, same reason, as the LEFT JOIN
   * on items in the purchase request list (§5f).
   */
  siteId: z.string().nullable(),
  siteName: z.string().nullable(),

  companyId: z.string(),
  companyName: z.string(),

  documentDate: z.string().nullable(),
  createdAt: z.string(),

  /** Decimal strings throughout — money never becomes a float. */
  quantity: z.string(),

  /** `unit_price` — one unit BEFORE discount. The legacy `Price` column. */
  unitPrice: z.string(),
  discountPerUnit: z.string(),

  /**
   * The LINE's GST percentage, not the item master's.
   *
   * DEFECT 2, not reproduced. The legacy partial's GST column renders
   * `@item.GSTper`, which the query fills from `f.Gstper` — the ITEM MASTER's
   * rate as it stands today. So a 2023 invoice raised at 12% displays 18% the
   * moment somebody edits the item, and the history rewrites itself. The rate
   * that was actually charged is on the line.
   */
  gstPercent: z.string().nullable(),

  gstAmount: z.string(),

  /** `(unitPrice − discountPerUnit) × quantity`, rounded. */
  netAmount: z.string(),

  /** `netAmount + gstAmount`. */
  lineTotal: z.string(),

  /**
   * What one unit actually cost, after discount and before GST.
   *
   * ADDED. The legacy panel shows the list price and leaves the reader to spot
   * that a discount was taken; on a screen whose only job is comparing prices
   * over time, the discounted price is the number being compared.
   */
  effectiveUnitPrice: z.string(),

  /**
   * What one unit cost including GST — `lineTotal / quantity`.
   *
   * DEFECT 3, not reproduced, and this is the expensive one. The legacy partial
   * computes its `PriceWithGST` column as
   *
   *     decimal? PerItemTotalAmoount = TotalAmount / Quantity;
   *
   * where `TotalAmount` is the INVOICE HEADER's grand total (`a.TotalAmount`)
   * and `Quantity` is ONE LINE's quantity (`e.Quantity`). On a single-line
   * invoice with no TDS that lands near the right answer by coincidence. On a
   * multi-line invoice it divides the whole document by one of its lines, so an
   * item bought on a large mixed invoice shows a per-unit price several times
   * what was paid — in the column a buyer reads to decide what to pay next.
   */
  effectiveUnitPriceWithGst: z.string(),

  /**
   * Carried so an unapproved invoice can be marked as one.
   *
   * The legacy query has no approval filter, so unapproved invoices have always
   * appeared here. They are prices not yet confirmed by anyone, which is worth
   * seeing rather than hiding — dropping them would change what the panel
   * contains, and showing them unmarked is what the source does.
   */
  isApproved: z.boolean(),
});
export type ItemPriceHistoryRow = z.infer<typeof itemPriceHistoryRowSchema>;

/**
 * NOT a keyset page.
 *
 * Every list endpoint in this system is keyset-paginated and this one is not,
 * deliberately. It is a bounded panel opened from one row, sorted newest first
 * over a nullable `document_date` — and §7.2 is exactly that a nullable keyset
 * sort column silently drops rows. So it takes a limit, reports the true
 * `total`, and says when it is showing part of it. A history that quietly
 * omitted its oldest rows would be worse than one that admits to a cap.
 */
export const itemPriceHistorySchema = z.object({
  rows: z.array(itemPriceHistoryRowSchema),
  /** Every matching line, whether or not it fitted in `rows`. */
  total: z.number().int().nonnegative(),
});
export type ItemPriceHistory = z.infer<typeof itemPriceHistorySchema>;

/**
 * The number of lines a single request will return.
 *
 * The legacy panel renders every row into a fixed 506px scroll box, which for a
 * weekly-bought item is years of scrolling. 50 is a couple of years of a
 * regular purchase; the total tells the reader what they are not seeing.
 */
export const ITEM_PRICE_HISTORY_DEFAULT_LIMIT = 50;
export const ITEM_PRICE_HISTORY_MAX_LIMIT = 200;

export const itemPriceHistoryQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(ITEM_PRICE_HISTORY_MAX_LIMIT)
    .default(ITEM_PRICE_HISTORY_DEFAULT_LIMIT),
});
export type ItemPriceHistoryQuery = z.infer<typeof itemPriceHistoryQuerySchema>;

/**
 * The one row the legacy query excludes, and the only magic string in it.
 *
 * `where a.InvoiceNo != "PayOut"` — payments are written into the invoice table
 * with the literal number `PayOut`, so every read of that table has to exclude
 * them by string. They are not invoices and carry no item lines worth pricing.
 * Reproduced rather than replaced: the payments model is Phase 5 and blocked on
 * D7, so until it exists an ETL will load those rows exactly as they are and
 * this filter is what keeps them out of a price history.
 */
export const PAYOUT_INVOICE_NO = "PayOut";
