import { sql } from "drizzle-orm";
import { financialYear } from "@accountmanagement/domain";
import { documentCounters } from "../db/schema";
import type { Database } from "../db/database";

/**
 * Atomic document numbering, shared by every document type that has a sequence.
 *
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` takes a row lock for the
 * duration of the statement, so two concurrent callers serialise and get
 * consecutive numbers. Read-then-write cannot do that without an explicit lock,
 * which is why both source implementations hand out duplicates.
 *
 * Always call this on a TRANSACTION handle, so a failed insert rolls the number
 * back rather than burning it.
 *
 * ---
 *
 * WHAT THE SOURCE DOES FOR PURCHASE ORDERS, and the two defects it carries.
 * `PurchaseOrderRepo.CheckPONo()`, which is a different implementation from the
 * purchase request one and wrong in a different way:
 *
 *  1. IT IGNORES THE FINANCIAL YEAR when it looks for the last number.
 *     `Where(a => a.ToCompanyId == CompanyId).OrderByDescending(e => e.CreatedOn)`
 *     takes the company's most recent order whatever year it belongs to, then
 *     formats the NEW number with the CURRENT year. So the first order after
 *     1 April continues the previous year's count instead of restarting:
 *     `DHP/PO/24-25/049` is followed by `DHP/PO/25-26/050`, and 25-26 never has
 *     an 001. The sequence is per company but only accidentally per year.
 *
 *     Reproducing that would mean seeding each new year from the last one, which
 *     is not a business rule anyone stated — it is an ordering bug. The counter
 *     here is keyed by year and starts each year at 001, like the purchase
 *     request sequence beside it and like the number's own format implies.
 *     FLAGGED FOR SIGN-OFF: the first PO of a new financial year will be 001
 *     where the old system would have continued counting.
 *
 *  2. IT SWALLOWS ITS OWN FAILURE. The whole body is wrapped in
 *     `catch (Exception ex) { return "Error generating Purchase Order number."; }`
 *     — it returns the ERROR MESSAGE AS THE NUMBER. Nothing downstream checks,
 *     so that sentence is what would be written to `Poid` and printed on the
 *     order. The `throw` for a malformed previous number is therefore not a
 *     guard; it is a way of stamping a document with an English sentence.
 */

export interface DocumentNumberRequest {
  /** `"purchase_request"`, `"purchase_order"`. */
  documentType: string;
  /**
   * The company the sequence belongs to, or null for a global sequence.
   *
   * Determines which of the two partial unique indexes on `document_counters`
   * the upsert infers — see the column comment there.
   */
  companyId?: string | null;
  /** Formats the issued number. Receives the financial year as `"25-26"`. */
  format: (year: string, issued: number) => string;
  now?: Date;
}

/**
 * Allocates the next number for a document type, financial year and (optionally)
 * company, and returns it formatted.
 */
export async function nextDocumentNumber(
  tx: Database,
  { documentType, companyId = null, format, now = new Date() }: DocumentNumberRequest,
): Promise<string> {
  const year = financialYear.format(financialYear.currentAsProduced(now));

  // The conflict target must match ONE of the two partial unique indexes, and
  // which one depends on whether this sequence is company-scoped. Postgres infers
  // a partial index only when the predicate is supplied, so the WHERE is not
  // optional decoration — without it the statement errors with "there is no
  // unique or exclusion constraint matching the ON CONFLICT specification".
  const [counter] = companyId
    ? await tx
        .insert(documentCounters)
        .values({ documentType, financialYear: year, companyId, nextValue: 2 })
        .onConflictDoUpdate({
          target: [
            documentCounters.documentType,
            documentCounters.financialYear,
            documentCounters.companyId,
          ],
          targetWhere: sql`${documentCounters.companyId} is not null`,
          set: { nextValue: sql`${documentCounters.nextValue} + 1`, updatedAt: now },
        })
        .returning({ nextValue: documentCounters.nextValue })
    : await tx
        .insert(documentCounters)
        .values({ documentType, financialYear: year, companyId: null, nextValue: 2 })
        .onConflictDoUpdate({
          target: [documentCounters.documentType, documentCounters.financialYear],
          targetWhere: sql`${documentCounters.companyId} is null`,
          set: { nextValue: sql`${documentCounters.nextValue} + 1`, updatedAt: now },
        })
        .returning({ nextValue: documentCounters.nextValue });

  // On INSERT the row stores the value the NEXT document takes, so the number
  // issued now is one less. On UPDATE the same is true after incrementing.
  const issued = (counter?.nextValue ?? 2) - 1;
  return format(year, issued);
}

/** `PR/25-26/001` — the purchase request format, unchanged. */
export const purchaseRequestNumber = (year: string, issued: number): string =>
  `PR/${year}/${String(issued).padStart(3, "0")}`;

/**
 * `DHP/PO/24-25/049` — the company's invoice prefix, then PO, year and sequence.
 *
 * The prefix is `companies.invoice_prefix` (`InvoicePef`), trimmed as the source
 * trims it. A company with no prefix would otherwise produce `/PO/25-26/001`
 * with a leading slash, so the segment is omitted entirely instead — and the
 * caller is expected to have refused the order before it gets here.
 */
export const purchaseOrderNumber =
  (invoicePrefix: string | null | undefined) =>
  (year: string, issued: number): string => {
    const prefix = invoicePrefix?.trim();
    const lead = prefix ? `${prefix}/` : "";
    return `${lead}PO/${year}/${String(issued).padStart(3, "0")}`;
  };
