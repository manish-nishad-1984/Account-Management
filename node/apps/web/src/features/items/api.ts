import { useQuery } from "@tanstack/react-query";
import {
  itemDetailSchema,
  itemRowSchema,
  listResponseSchema,
  unitRowSchema,
  type CreateItem,
  type CreateUnit,
  type ItemDetail,
  type ItemRow,
  type ListResponse,
  type UnitRow,
  type UpdateItem,
  type UpdateUnit,
} from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "items";
const UNITS = "units";

export const useItemList = (params: ListParams) =>
  useListResource<ItemRow>(RESOURCE, itemRowSchema, params);

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

export const useCreateUnit = () => useCreateResource<CreateUnit, UnitRow>(UNITS, unitRowSchema);
export const useUpdateUnit = () => useUpdateResource<UpdateUnit, UnitRow>(UNITS, unitRowSchema);
export const useDeleteUnit = () => useDeleteResource(UNITS);
