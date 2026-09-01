import { z } from "zod";

/**
 * Paged list contract, per 11-UI-to-React-Mapping.md §1.1:
 *   { cursor, limit, sortBy, sortDir, filters } -> { rows, nextCursor, total }
 *
 * KEYSET pagination, not OFFSET. `.Skip()`/`.Take()` appear zero times in the
 * existing repository layer, so there is nothing to preserve — and offset
 * pagination degrades on exactly the large tables that hurt today, because the
 * database still walks every skipped row. A cursor encodes the last row's sort
 * key, so page 500 costs the same as page 1.
 */

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 25;

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sortBy: z.string().optional(),
  sortDir: z.enum(SORT_DIRECTIONS).default("asc"),
  search: z.string().trim().max(200).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * Capability flags travel with every row.
 *
 * Permission logic currently lives inside Razor partials that will cease to
 * exist, so the server states per row what this caller may do with it. The client
 * renders buttons from these; the server still re-checks on the actual call.
 */
export const rowCapabilitiesSchema = z.object({
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canApprove: z.boolean(),
});
export type RowCapabilities = z.infer<typeof rowCapabilitiesSchema>;

export const listResponseSchema = <T extends z.ZodTypeAny>(row: T) =>
  z.object({
    rows: z.array(row),
    nextCursor: z.string().nullable(),
    /** Omitted when counting would be too expensive; the grid then hides the total. */
    total: z.number().int().nonnegative().nullable(),
  });

export type ListResponse<T> = {
  rows: T[];
  nextCursor: string | null;
  total: number | null;
};
