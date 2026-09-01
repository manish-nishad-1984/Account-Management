import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  userDetailSchema,
  userPermissionsSchema,
  userRowSchema,
  type CreateUser,
  type SaveUserPermissions,
  type UpdateUser,
  type UserDetail,
  type UserPermissions,
  type UserRow,
} from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";
import {
  useCreateResource,
  useDeleteResource,
  useReplaceResource,
  useUpdateResource,
} from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "users";

export const useUserList = (params: ListParams) =>
  useListResource<UserRow>(RESOURCE, userRowSchema, params);

export const useUser = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<UserDetail>(`/${RESOURCE}/${id}`, { schema: userDetailSchema, signal }),
  });

const optionsSchema = z.object({
  sites: z.array(z.object({ id: z.string(), name: z.string() })),
  companies: z.array(z.object({ id: z.string(), name: z.string() })),
});

/**
 * The sites and companies a user can be assigned to.
 *
 * Cached with a long `staleTime`: this is a pair of small, slow-moving lookup
 * lists, and refetching them every time the user dialog opens is pure noise.
 */
export const useAssignmentOptions = (enabled: boolean) =>
  useQuery({
    queryKey: [RESOURCE, "options"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: ({ signal }) =>
      apiRequest(`/${RESOURCE}/options`, { schema: optionsSchema, signal }),
  });

export const useCreateUser = () => useCreateResource<CreateUser, UserDetail>(RESOURCE, userDetailSchema);
export const useUpdateUser = () => useUpdateResource<UpdateUser, UserDetail>(RESOURCE, userDetailSchema);
export const useDeleteUser = () => useDeleteResource(RESOURCE);

export const useUserPermissions = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "permissions", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<UserPermissions>(`/${RESOURCE}/${id}/permissions`, {
        schema: userPermissionsSchema,
        signal,
      }),
  });

export const useSaveUserPermissions = () =>
  useReplaceResource<SaveUserPermissions, UserPermissions>(
    (id) => `/${RESOURCE}/${id}/permissions`,
    RESOURCE,
    userPermissionsSchema,
  );
