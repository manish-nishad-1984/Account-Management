import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  documentTemplateListSchema,
  documentTemplateSchema,
  printBundleSchema,
  type CreateDocumentTemplate,
  type DocumentTemplate,
  type DocumentTemplateList,
  type DocumentType,
  type PrintBundle,
  type UpdateDocumentTemplate,
} from "@accountmanagement/contracts";
import type { z } from "zod";
import { apiRequest, deleteRequest } from "../../lib/api-client";

const RESOURCE = "document-templates";

/**
 * The layout schemas fill in defaults, so what they accept and what they return
 * are different types. `apiRequest` wants one type for both; these say which.
 */
const templateSchema = documentTemplateSchema as unknown as z.ZodType<DocumentTemplate>;
const listSchema = documentTemplateListSchema as unknown as z.ZodType<DocumentTemplateList>;
const bundleSchema = printBundleSchema as unknown as z.ZodType<PrintBundle>;

export const useDocumentTemplates = (documentType: DocumentType) =>
  useQuery({
    queryKey: [RESOURCE, "list", documentType],
    queryFn: ({ signal }) =>
      apiRequest(`/${RESOURCE}?documentType=${documentType}`, {
        schema: listSchema,
        signal,
      }),
  });

/** Every write refetches the lists: a new default changes two cards at once. */
function useTemplateMutation<TVariables>(
  send: (variables: TVariables) => Promise<DocumentTemplate | void>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [RESOURCE] }),
  });
}

export const useCreateTemplate = () =>
  useTemplateMutation((body: CreateDocumentTemplate) =>
    apiRequest(`/${RESOURCE}`, { method: "POST", body, schema: templateSchema }),
  );

export const useUpdateTemplate = () =>
  useTemplateMutation(({ id, body }: { id: string; body: UpdateDocumentTemplate }) =>
    apiRequest(`/${RESOURCE}/${id}`, { method: "PATCH", body, schema: templateSchema }),
  );

export const useDuplicateTemplate = () =>
  useTemplateMutation((id: string) =>
    apiRequest(`/${RESOURCE}/${id}/duplicate`, { method: "POST", schema: templateSchema }),
  );

export const useMakeDefaultTemplate = () =>
  useTemplateMutation((id: string) =>
    apiRequest(`/${RESOURCE}/${id}/default`, { method: "PUT", schema: templateSchema }),
  );

export const useDeleteTemplate = () => useTemplateMutation((id: string) => deleteRequest(`/${RESOURCE}/${id}`));

/** A document ready to print, with the templates that may print it. */
export const usePrintBundle = (documentType: DocumentType, id: string | null) =>
  useQuery({
    queryKey: ["document-print", documentType, id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiRequest(`/document-print/${documentType}/${id}`, { schema: bundleSchema, signal }),
  });
