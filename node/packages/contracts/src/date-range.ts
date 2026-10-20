import { z } from "zod";

/**
 * A DATE RANGE ON A LIST, and which of its record's dates it counts by (client,
 * 20 Oct 2026: the Excel export centre, "as the balance sheet asks which dates
 * to count").
 *
 * Every document carries two dates: its OWN — the bill's date, the payment's
 * date, the income's date — and the day it was ENTERED. A bill dated March and
 * keyed in April belongs to March's books and to April's data entry; which one
 * a person wants depends on the question, so the list is told.
 *
 * Days, not instants: `2026-04-01`. Both ends are included. A document date is
 * read as the day it names; an entry date as the day it was in India.
 */
export const DATE_BASES = ["document", "entry"] as const;
export type DateBasis = (typeof DATE_BASES)[number];

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date as yyyy-mm-dd");

export const dateRangeFilterSchema = z.object({
  fromDate: isoDay.optional(),
  toDate: isoDay.optional(),
  /** Omitted: the document's own date. */
  dateBasis: z.enum(DATE_BASES).optional(),
});
export type DateRangeFilter = z.infer<typeof dateRangeFilterSchema>;
