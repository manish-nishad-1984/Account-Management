import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import {
  listResponseSchema,
  type ListQuery,
  type ListResponse,
} from "@accountmanagement/contracts";
import { apiRequest } from "./api-client";

/**
 * The client half of the paged-list contract.
 *
 * Every list screen sends the same query shape and reads the same response shape,
 * so this is written once. The alternative — a bespoke `useXList` per screen — is
 * how the .NET app ended up with 19 grids that page in 19 different ways, three of
 * which set `serverSide: true` and `paging: false` at the same time.
 */

export type ListParams = Pick<ListQuery, "limit" | "sortBy" | "sortDir"> & {
  cursor?: string;
  search?: string;
};

export const listSearchParams = (params: ListParams): string => {
  const search = new URLSearchParams();
  search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.sortBy) search.set("sortBy", params.sortBy);
  if (params.sortDir) search.set("sortDir", params.sortDir);
  if (params.search) search.set("search", params.search);
  return search.toString();
};

/**
 * TanStack Query keeps each page cached under its own key, so paging backwards is
 * instant and repeated visits do not re-fetch. `placeholderData` holds the previous
 * page on screen while the next loads, which stops the grid flashing empty.
 *
 * `rowSchema` must be a module-level constant, not built inline — it is part of the
 * response schema this hook rebuilds on every render, and that is cheap only
 * because the schemas themselves are shared singletons.
 */
export function useListResource<T>(
  resource: string,
  rowSchema: z.ZodType<T>,
  params: ListParams,
) {
  return useQuery<ListResponse<T>>({
    queryKey: [resource, params],
    queryFn: ({ signal }) =>
      apiRequest(`/${resource}?${listSearchParams(params)}`, {
        schema: listResponseSchema(rowSchema) as unknown as z.ZodType<ListResponse<T>>,
        signal,
      }),
    placeholderData: (previous) => previous,
  });
}
