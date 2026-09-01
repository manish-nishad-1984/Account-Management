import { useQuery } from "@tanstack/react-query";
import {
  listResponseSchema,
  userRowSchema,
  type ListQuery,
  type ListResponse,
  type UserRow,
} from "@accountmanagement/contracts";
import { apiRequest } from "../../lib/api-client";

const userListResponseSchema = listResponseSchema(userRowSchema);

export type UserListParams = Pick<ListQuery, "limit" | "sortBy" | "sortDir"> & {
  cursor?: string;
  search?: string;
};

const toSearchParams = (params: UserListParams): string => {
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
 */
export function useUserList(params: UserListParams) {
  return useQuery<ListResponse<UserRow>>({
    queryKey: ["users", params],
    queryFn: ({ signal }) =>
      apiRequest(`/users?${toSearchParams(params)}`, {
        schema: userListResponseSchema,
        signal,
      }),
    placeholderData: (previous) => previous,
  });
}
