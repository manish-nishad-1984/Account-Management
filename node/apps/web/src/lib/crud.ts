import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { FieldErrors, FieldValues, Path, UseFormSetError } from "react-hook-form";
import type { z } from "zod";
import { ApiError, apiRequest, deleteRequest } from "./api-client";

/**
 * The write half of the list contract, matching `useListResource` on the read
 * half.
 *
 * Written once for the same reason: 19 grids in the .NET app page in 19
 * different ways because each screen grew its own plumbing. Every master here
 * creates, updates and deletes through this, so cache invalidation, error
 * mapping and the pending state behave identically on all of them.
 */

/**
 * Every mutation invalidates the WHOLE resource key, not the exact page.
 *
 * A create can land on any page under the current sort, a rename moves the row,
 * and a delete shifts every subsequent row across page boundaries — so the page
 * the user is looking at is not the only one that went stale. TanStack Query
 * refetches only the queries that are actually mounted, which under keyset
 * paging is the visible page and any still in the cache.
 */
const invalidate = (queryClient: ReturnType<typeof useQueryClient>, resource: string) =>
  queryClient.invalidateQueries({ queryKey: [resource] });

export function useCreateResource<TInput, TResult>(
  resource: string,
  schema: z.ZodType<TResult>,
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TInput) =>
      apiRequest<TResult>(`/${resource}`, { method: "POST", body, schema }),
    onSuccess: () => invalidate(queryClient, resource),
  });
}

export function useUpdateResource<TInput, TResult>(
  resource: string,
  schema: z.ZodType<TResult>,
): UseMutationResult<TResult, Error, { id: string | number; body: TInput }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      apiRequest<TResult>(`/${resource}/${id}`, { method: "PATCH", body, schema }),
    onSuccess: () => invalidate(queryClient, resource),
  });
}

export function useDeleteResource(
  resource: string,
): UseMutationResult<void, Error, string | number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => deleteRequest(`/${resource}/${id}`),
    onSuccess: () => invalidate(queryClient, resource),
  });
}

/** A PUT that replaces a whole sub-resource — the user permission matrix. */
export function useReplaceResource<TInput, TResult>(
  path: (id: string) => string,
  invalidateKey: string,
  schema: z.ZodType<TResult>,
): UseMutationResult<TResult, Error, { id: string; body: TInput }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      apiRequest<TResult>(path(id), { method: "PUT", body, schema }),
    onSuccess: () => invalidate(queryClient, invalidateKey),
  });
}

/**
 * A form-level message for a submit that validation blocked invisibly.
 *
 * Field errors normally render beside their field, so a banner would be noise.
 * But an error on an ARRAY ELEMENT — `siteIds.0` — has no field to render
 * beside: the multi-select shows `errors.siteIds.message`, which is undefined
 * when the failure is nested. The result is a Save button that does nothing, with
 * no explanation anywhere on screen, which is the worst possible outcome and
 * exactly what happened before this existed.
 *
 * So: if nothing among the errors carries a top-level message, nothing is
 * rendered, and the form says so itself.
 */
export function unshownValidationMessage(errors: FieldErrors): string | null {
  const keys = Object.keys(errors);
  if (keys.length === 0) {
    return null;
  }

  const anyRendered = keys.some(
    (key) => typeof (errors[key] as { message?: unknown } | undefined)?.message === "string",
  );
  if (anyRendered) {
    return null;
  }

  return `Some values could not be accepted: ${keys.join(", ")}. Check your selections and try again.`;
}

/**
 * Attaches a server rejection to the form fields that caused it.
 *
 * Both rejection sources produce the same `issues` shape — Zod through
 * `ZodValidationPipe`, and PostgreSQL constraint violations through
 * `rethrowConflict` — so a duplicate GST number lands on the GST field exactly
 * as a malformed one does, and the form does not have to know which layer
 * refused it.
 *
 * Anything without a field (a 409 about assigned users, a 503 with no database)
 * is returned as a message for the form to show at the top, because there is no
 * field it belongs to.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): string | null {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }

  if (error.issues && error.issues.length > 0) {
    let attached = 0;
    for (const issue of error.issues) {
      if (issue.path) {
        setError(issue.path as Path<T>, { type: "server", message: issue.message });
        attached += 1;
      }
    }
    // Issues with no path have nowhere to go but the form-level banner.
    if (attached === error.issues.length) {
      return null;
    }
  }

  return error.message;
}
