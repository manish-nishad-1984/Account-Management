import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { dateRangeFilterSchema, type DateRangeFilter } from "@accountmanagement/contracts";

export { dateRangeFilterSchema, type DateRangeFilter };

/**
 * A list's date range as SQL (client, 20 Oct 2026: the Excel export centre).
 *
 * WHICH DAY A TIMESTAMP FALLS ON DEPENDS ON THE CLOCK READING IT. A document
 * date is stored as midnight UTC of the day it names — every one of the 2,785
 * live bills reads 00:00 — so it is read in UTC. An entry date is the moment
 * somebody pressed Save, and "entered on the 1st" means the 1st in India, so it
 * is read there: a bill saved at 1 a.m. IST is the 1st, not the 31st before.
 *
 * Written as a range on the bare column rather than as `column::date`, so the
 * index on the column still serves it.
 */
export interface DateRangeColumns {
  /** The record's own date: a `timestamptz` at midnight UTC, or a plain `date`. */
  document: AnyPgColumn | SQL;
  documentIsDate?: boolean;
  /** When it was entered. */
  entry: AnyPgColumn | SQL;
}

const INDIA = "Asia/Kolkata";

export function dateRangeWhere(columns: DateRangeColumns, filter: DateRangeFilter): SQL[] {
  const where: SQL[] = [];
  if (!filter.fromDate && !filter.toDate) return where;

  if (filter.dateBasis === "entry") {
    if (filter.fromDate) where.push(sql`${columns.entry} >= (${filter.fromDate}::date::timestamp at time zone ${INDIA})`);
    if (filter.toDate) where.push(sql`${columns.entry} < ((${filter.toDate}::date + 1)::timestamp at time zone ${INDIA})`);
    return where;
  }

  if (columns.documentIsDate) {
    if (filter.fromDate) where.push(sql`${columns.document} >= ${filter.fromDate}::date`);
    if (filter.toDate) where.push(sql`${columns.document} <= ${filter.toDate}::date`);
    return where;
  }
  if (filter.fromDate) where.push(sql`${columns.document} >= (${filter.fromDate}::date::timestamp at time zone 'UTC')`);
  if (filter.toDate) where.push(sql`${columns.document} < ((${filter.toDate}::date + 1)::timestamp at time zone 'UTC')`);
  return where;
}

/** The three keys out of a parsed query, so a controller passes them on in one go. */
export const dateRangeOf = (query: DateRangeFilter): DateRangeFilter => ({
  fromDate: query.fromDate,
  toDate: query.toDate,
  dateBasis: query.dateBasis,
});
