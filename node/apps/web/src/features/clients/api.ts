import { useQuery } from "@tanstack/react-query";
import {
  clientDetailSchema,
  clientRowSchema,
  listResponseSchema,
  type ClientDetail,
  type ClientRow,
  type CreateClient,
  type ListResponse,
  type UpdateClient,
} from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";
import { useCreateResource, useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "clients";

export const useClientList = (params: ListParams) =>
  useListResource<ClientRow>(RESOURCE, clientRowSchema, params);

export const useClient = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<ClientDetail>(`/${RESOURCE}/${id}`, { schema: clientDetailSchema, signal }),
  });

/**
 * The clients that pay for ONE project, for the Income form's Client dropdown.
 * Held until a project is chosen: without one there is nothing sensible to offer.
 */
export const useClientsOfSite = (siteId: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "of-site", siteId],
    enabled: siteId !== null,
    queryFn: ({ signal }) =>
      apiRequest<ListResponse<ClientRow>>(`/${RESOURCE}?limit=200&sortBy=name&siteId=${siteId}`, {
        schema: listResponseSchema(clientRowSchema) as never,
        signal,
      }),
  });

export const useCreateClient = () => useCreateResource<CreateClient, ClientDetail>(RESOURCE, clientDetailSchema);
export const useUpdateClient = () => useUpdateResource<UpdateClient, ClientDetail>(RESOURCE, clientDetailSchema);
export const useDeleteClient = () => useDeleteResource(RESOURCE);
