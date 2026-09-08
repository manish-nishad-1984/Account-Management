import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  itemDetailSchema,
  itemRowSchema,
  itemSheetFileName,
  itemSheetImportResultSchema,
  listResponseSchema,
  unitRowSchema,
  type CreateItem,
  type CreateUnit,
  type ItemDetail,
  type ItemRow,
  type ItemSheetImportResult,
  type ListResponse,
  type UnitRow,
  type UpdateItem,
  type UpdateUnit,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { ApiError, apiRequest, downloadRequest, uploadRequest } from "../../lib/api-client";

const RESOURCE = "items";
const UNITS = "units";

/** `isApproved: false` is the dashboard's pending queue; the list screen passes nothing. */
export type ItemFilters = ListFilters & { isApproved?: boolean };

export const useItemList = (params: ListParams, filters: ItemFilters = {}) =>
  useListResource<ItemRow>(RESOURCE, itemRowSchema, params, filters);

export const useItem = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<ItemDetail>(`/${RESOURCE}/${id}`, { schema: itemDetailSchema, signal }),
  });

export const useCreateItem = () => useCreateResource<CreateItem, ItemDetail>(RESOURCE, itemDetailSchema);
export const useUpdateItem = () => useUpdateResource<UpdateItem, ItemDetail>(RESOURCE, itemDetailSchema);
export const useDeleteItem = () => useDeleteResource(RESOURCE);

export const useUnitList = (params: ListParams) =>
  useListResource<UnitRow>(UNITS, unitRowSchema, params);

/**
 * Every unit, for the item form's dropdown.
 *
 * Fetched at the maximum page size rather than paged, because a `<select>` that
 * only offers the first page is worse than useless — the unit a person needs is
 * silently absent and nothing says why. The list is bounded by how many units of
 * measure a construction business uses, which is dozens; if it ever approached
 * MAX_PAGE_SIZE this has to become a search-as-you-type control, so the count is
 * surfaced on the Units screen where it will be noticed.
 */
export const useAllUnits = () =>
  useQuery({
    queryKey: [UNITS, "all"],
    queryFn: ({ signal }) =>
      apiRequest<ListResponse<UnitRow>>(`/${UNITS}?limit=200&sortBy=name`, {
        schema: listResponseSchema(unitRowSchema) as never,
        signal,
      }),
  });

/**
 * "Download File" — the catalogue as a spreadsheet.
 *
 * A `fetch`, not an anchor, for the same reason attachment downloads are: the
 * access token lives in memory and never in a cookie, so a browser-initiated
 * navigation carries no credentials and the server answers 401.
 *
 * The CURRENT SEARCH goes with it. The legacy download does pass `searchText`,
 * `searchBy` and `sortBy` through to its API, but as default-valued C# string
 * parameters they interpolate into the URL as the literal `null`, so its file
 * is the unfiltered list whatever the box says. Exporting what is on screen is
 * what people mean by Download.
 */
export async function downloadItemSheet(search?: string): Promise<void> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const blob = await downloadRequest(`/${RESOURCE}/export${query}`);
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = itemSheetFileName(new Date());
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Without this every download leaks its blob for the life of the page.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * "Upload File".
 *
 * A rejected import is a 400 whose body IS the result — every bad row with its
 * number — so the dialog reads `error.body` rather than only the message. The
 * mutation still throws: nothing was written, and the screen must not report a
 * success.
 */
export const useImportItemSheet = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      uploadRequest<ItemSheetImportResult>(`/${RESOURCE}/import`, [file], {
        schema: itemSheetImportResultSchema,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [RESOURCE] });
    },
  });
};

/** The rejected result out of a failed import, or null when it failed some other way. */
export function importRejectionFrom(error: unknown): ItemSheetImportResult | null {
  if (!(error instanceof ApiError) || !error.body) return null;
  const parsed = itemSheetImportResultSchema.safeParse(error.body);
  return parsed.success ? parsed.data : null;
}

export const useCreateUnit = () => useCreateResource<CreateUnit, UnitRow>(UNITS, unitRowSchema);
export const useUpdateUnit = () => useUpdateResource<UpdateUnit, UnitRow>(UNITS, unitRowSchema);
export const useDeleteUnit = () => useDeleteResource(UNITS);
