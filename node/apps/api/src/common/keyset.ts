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
  const beyond = direction === "asc" ? gt : lt;
  return or(
    beyond(sortColumn, cursor.value),
    and(sql`${sortColumn} = ${cursor.value}`, beyond(idColumn, cursor.id)),
  );
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
