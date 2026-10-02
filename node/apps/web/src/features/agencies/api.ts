import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  agencyDetailSchema,
  agencyRowSchema,
  agencySummarySchema,
  cityOptionSchema,
  stateOptionSchema,
  workTypeSchema,
  type AgencyDetail,
  type AgencyRow,
  type CreateAgency,
  type UpdateAgency,
  type WorkType,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "agencies";

export type AgencyFilters = ListFilters & { workTypeId?: number; isActive?: boolean; cityId?: number };

export const useAgencyList = (params: ListParams, filters: AgencyFilters = {}) =>
  useListResource<AgencyRow>(RESOURCE, agencyRowSchema, params, filters);

/**
 * The three tiles and the City filter's options. Keyed under `agencies`, so a
 * save — which invalidates that prefix — recounts the tiles too.
 */
export const useAgencySummary = () =>
  useQuery({
    queryKey: [RESOURCE, "summary"],
    queryFn: ({ signal }) => apiRequest(`/${RESOURCE}/summary`, { schema: agencySummarySchema, signal }),
  });

export const useAgency = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) => apiRequest<AgencyDetail>(`/${RESOURCE}/${id}`, { schema: agencyDetailSchema, signal }),
  });

export const useCreateAgency = () => useCreateResource<CreateAgency, AgencyDetail>(RESOURCE, agencyDetailSchema);
export const useUpdateAgency = () => useUpdateResource<UpdateAgency, AgencyDetail>(RESOURCE, agencyDetailSchema);
export const useDeleteAgency = () => useDeleteResource(RESOURCE);

const WORK_TYPES = [RESOURCE, "work-types"] as const;

export const useWorkTypes = () =>
  useQuery({
    queryKey: WORK_TYPES,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      apiRequest(`/${RESOURCE}/work-types`, { schema: z.array(workTypeSchema), signal }),
  });

export const useCreateWorkType = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiRequest<WorkType>(`/${RESOURCE}/work-types`, { method: "POST", body: { name }, schema: workTypeSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORK_TYPES }),
  });
};

/** Reference data: it does not change while a form is open. */
export const useStates = () =>
  useQuery({
    queryKey: ["geography", "states"],
    staleTime: Infinity,
    queryFn: ({ signal }) => apiRequest("/geography/states", { schema: z.array(stateOptionSchema), signal }),
  });

export const useCities = (stateId: number | null) =>
  useQuery({
    queryKey: ["geography", "cities", stateId],
    enabled: stateId !== null,
    staleTime: Infinity,
    queryFn: ({ signal }) =>
      apiRequest(`/geography/cities?stateId=${stateId}`, { schema: z.array(cityOptionSchema), signal }),
  });
