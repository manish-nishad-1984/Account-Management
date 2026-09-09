import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  paymentBatchResultSchema,
  paymentDetailSchema,
  paymentRowSchema,
  type CreatePaymentBatch,
  type PaymentBatchResult,
  type PaymentDetail,
  type PaymentRow,
  type UpdatePayment,
} from "@accountmanagement/contracts";
import { useListResource, type ListFilters, type ListParams } from "../../lib/list-query";
import { useDeleteResource, useUpdateResource } from "../../lib/crud";
import { apiRequest } from "../../lib/api-client";

const RESOURCE = "payments";

export type PaymentFilters = ListFilters & {
  direction?: "out" | "in";
  partyId?: string;
  companyId?: string;
  siteId?: string;
};

export const usePaymentList = (params: ListParams, filters: PaymentFilters = {}) =>
  useListResource<PaymentRow>(RESOURCE, paymentRowSchema, params, filters);

export const usePayment = (id: string | null) =>
  useQuery({
    queryKey: [RESOURCE, "detail", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest<PaymentDetail>(`/${RESOURCE}/${id}`, { schema: paymentDetailSchema, signal }),
  });

/**
 * The repeater posts once, not once per row.
 *
 * `useCreateResource` is not used because the response is a COUNT rather than
 * the created resource — there is no single record to hand back and no Location
 * to point at. Everything the list shows is invalidated, and the reports are
 * too: a payment changes every balance that includes it, so a ledger left in
 * the cache would show the old closing figure on the next visit.
 */
export const useCreatePayments = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePaymentBatch) =>
      apiRequest<PaymentBatchResult>(`/${RESOURCE}`, {
        method: "POST",
        body,
        schema: paymentBatchResultSchema,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [RESOURCE] });
      client.invalidateQueries({ queryKey: ["reports"] });
    },
  });
};

export const useUpdatePayment = () =>
  useUpdateResource<UpdatePayment, PaymentDetail>(RESOURCE, paymentDetailSchema);

export const useDeletePayment = () => useDeleteResource(RESOURCE);
