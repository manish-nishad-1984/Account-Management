import { userRowSchema, type UserRow } from "@accountmanagement/contracts";
import { useListResource, type ListParams } from "../../lib/list-query";

export const useUserList = (params: ListParams) =>
  useListResource<UserRow>("users", userRowSchema, params);
