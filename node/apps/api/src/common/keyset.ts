import { BadRequestException } from "@nestjs/common";
import { and, asc, desc, gt, lt, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { SortDirection } from "@accountmanagement/contracts";

/**
 * Keyset ("seek") pagination for Drizzle.
 *
 * The cursor encodes the sort key and the tiebreaker id of the last row on the
 * previous page, so the next page is a WHERE, not an OFFSET. Cost is constant
 * regardless of depth.
 *
 * A tiebreaker is mandatory: sorting by a non-unique column alone (userName,
 * createdAt) makes row order undefined between equal values, and rows can be
 * skipped or repeated across pages. Every cursor therefore carries the primary key.
 *
 * LIMITATION — the sort column must be NOT NULL. In PostgreSQL every comparison
 * against NULL is itself NULL, so `sortColumn > cursorValue` excludes NULL rows
 * entirely while ORDER BY still places them last: paging by a nullable column
 * silently drops every row that has no value, and the row count never adds up.
 * Sortable fields are therefore restricted to non-nullable columns on every list
 * endpoint. Supporting a nullable sort means coalescing the column identically in
 * BOTH the ORDER BY and the WHERE, which these helpers do not do yet.
 */

export interface Cursor {
  readonly value: string;
  readonly id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.value, cursor.id]), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new BadRequestException("Malformed cursor");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string"
  ) {
    throw new BadRequestException("Malformed cursor");
  }
  return { value: parsed[0], id: parsed[1] };
}

/**
 * The WHERE clause that resumes after `cursor`.
 *
 * `(sortColumn, id) > (value, id)` as a row comparison — strictly after the last
 * row in the sort order, including the tiebreaker.
 */
export function keysetWhere(
  sortColumn: PgColumn,
  idColumn: PgColumn,
  direction: SortDirection,
  cursor: Cursor | null,
): SQL | undefined {
  if (!cursor) {
    return undefined;
  }
  const beyond = direction === "asc" ? "> " : "< ";
  const value = cursorValue(sortColumn, cursor.value);

  return or(
    sql`${sortColumn} ${sql.raw(beyond)} ${value}`,
    and(sql`${sortColumn} = ${value}`, direction === "asc" ? gt(idColumn, cursor.id) : lt(idColumn, cursor.id)),
  );
}

/**
 * The cursor value, cast IN SQL to the sort column's own type.
 *
 * A cursor is produced as `${sortColumn}::text` and comes back a string, so
 * comparing it with Drizzle's `gt(column, value)` hands that string to the
 * column's driver mapper. For a text or numeric column the mapper passes it
 * through; for a TIMESTAMP it calls `value.toISOString()` and throws
 * `value.toISOString is not a function`.
 *
 * That made every list in the application fail on the SECOND page whenever it
 * was sorted by `createdAt` — which is nine repositories, all of them offering
 * `createdAt` as a sortable field, and none of them exercising it past page one
 * until inventory inward made it the default sort. The first page worked, so
 * nothing looked wrong.
 *
 * Casting in SQL instead means the value never passes through the column mapper.
 * The round trip is exact: `timestamptz::text` renders a fixed format that casts
 * back to the same instant, and `numeric::text` likewise. `getSQLType()` comes
 * from our own schema, never from a request, so `sql.raw` is safe here.
 */
function cursorValue(sortColumn: PgColumn, value: string): SQL {
  return sql`cast(${value} as ${sql.raw(sortColumn.getSQLType())})`;
}

export function keysetOrder(
  sortColumn: PgColumn,
  idColumn: PgColumn,
  direction: SortDirection,
): SQL[] {
  const order = direction === "asc" ? asc : desc;
  return [order(sortColumn), order(idColumn)];
}

/**
 * Trims the over-fetched row and builds the next cursor.
 * Query for `limit + 1` rows; the extra one proves another page exists without
 * a second round trip.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Cursor,
): { rows: T[]; nextCursor: string | null } {
  if (rows.length <= limit) {
    return { rows, nextCursor: null };
  }
  const page = rows.slice(0, limit);
  const last = page[page.length - 1]!;
  return { rows: page, nextCursor: encodeCursor(cursorOf(last)) };
}
