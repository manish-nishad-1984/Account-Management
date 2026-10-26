import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  agencyPersonSchema,
  inventoryIssueListSchema,
  inventoryIssueRowSchema,
  inventoryItemRowSchema,
  photoUploadSchema,
  purchaseStockRowSchema,
  type AgencyPerson,
  type CreateAgencyPerson,
  type CreateInventoryIssue,
  type InventoryIssueRow,
  type InventoryItemRow,
  type IssueStatus,
  type PurchaseStockRow,
  type SaveInventoryItem,
} from "@accountmanagement/contracts";
import { apiRequest, deleteRequest, uploadRequest } from "../../lib/api-client";

/**
 * Stock, issue and receive back (client, 26 Oct 2026). Every key starts with
 * the arrivals' resource, so a New Arrival saved refreshes the stock too.
 */
const ROOT = "inventory-inward";
const STOCK = [ROOT, "stock"];

const itemsSchema = z.object({ rows: z.array(inventoryItemRowSchema) });
const agencySchema = z.array(
  z.object({ id: z.string(), name: z.string(), contacts: z.array(z.object({ id: z.string(), name: z.string(), mobile: z.string().nullable() })) }),
);
export type IssueAgency = z.infer<typeof agencySchema>[number];

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};

/** One photo up; its key back, for the form to name. */
export const uploadInventoryPhoto = (file: File) => uploadRequest("/inventory-photos", [file], { schema: photoUploadSchema });

export const useInventoryItems = (siteId: string | null | undefined) =>
  useQuery({
    queryKey: [...STOCK, "items", siteId ?? "all"],
    queryFn: ({ signal }) =>
      apiRequest<{ rows: InventoryItemRow[] }>(`/inventory-items${query({ siteId: siteId ?? undefined })}`, { schema: itemsSchema, signal }),
  });

export const usePurchaseStock = (siteId: string | null | undefined) =>
  useQuery({
    queryKey: [...STOCK, "purchase", siteId],
    enabled: !!siteId,
    queryFn: ({ signal }) =>
      apiRequest<PurchaseStockRow[]>(`/inventory-issues/purchase-stock?siteId=${siteId}`, { schema: z.array(purchaseStockRowSchema), signal }),
  });

export const useSaveInventoryItem = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: SaveInventoryItem }) =>
      apiRequest<{ id: string }>(id ? `/inventory-items/${id}` : "/inventory-items", {
        method: id ? "PATCH" : "POST",
        body,
        schema: z.object({ id: z.string() }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useDeleteInventoryItem = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRequest(`/inventory-items/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useIssueAgencies = () =>
  useQuery({
    queryKey: [...STOCK, "agencies"],
    queryFn: ({ signal }) => apiRequest<IssueAgency[]>("/inventory-issues/agencies", { schema: agencySchema, signal }),
  });

export const useAgencyPersons = (agencyId: string) =>
  useQuery({
    queryKey: [...STOCK, "persons", agencyId],
    enabled: agencyId !== "",
    queryFn: ({ signal }) =>
      apiRequest<AgencyPerson[]>(`/agency-persons?agencyId=${agencyId}`, { schema: z.array(agencyPersonSchema), signal }),
  });

export const useCreateAgencyPerson = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAgencyPerson) => apiRequest<AgencyPerson>("/agency-persons", { method: "POST", body, schema: agencyPersonSchema }),
    onSuccess: () => client.invalidateQueries({ queryKey: [...STOCK, "persons"] }),
  });
};

export const useInventoryIssues = (params: { siteId?: string | null; status?: IssueStatus; fromDate?: string; toDate?: string }) =>
  useQuery({
    queryKey: [...STOCK, "issues", params],
    queryFn: ({ signal }) =>
      apiRequest<{ rows: InventoryIssueRow[] }>(
        `/inventory-issues${query({ siteId: params.siteId ?? undefined, status: params.status, fromDate: params.fromDate, toDate: params.toDate })}`,
        { schema: inventoryIssueListSchema, signal },
      ),
  });

export const useIssueItem = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInventoryIssue) =>
      apiRequest<InventoryIssueRow>("/inventory-issues", { method: "POST", body, schema: inventoryIssueRowSchema }),
    onSuccess: () => client.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useReceiveIssue = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, quantity, note }: { id: string; quantity: string; note: string | null }) =>
      apiRequest<InventoryIssueRow>(`/inventory-issues/${id}/receive`, { method: "POST", body: { quantity, note }, schema: inventoryIssueRowSchema }),
    onSuccess: () => client.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useDeleteIssue = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRequest(`/inventory-issues/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: [ROOT] }),
  });
};
