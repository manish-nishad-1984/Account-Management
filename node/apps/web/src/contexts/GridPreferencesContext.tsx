import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  gridPreferencesResponseSchema,
  toGridPreference,
  type GridColumnDefault,
  type GridColumnPreference,
  type GridPreferencesResponse,
} from "@accountmanagement/contracts";
import { apiRequest } from "../lib/api-client";

/**
 * Everyone's own column layouts, fetched ONCE for the whole application.
 *
 * WHY A PROVIDER RATHER THAN A HOOK PER GRID. The first version fetched inside
 * `DataGrid`, so every grid asked the server for the same fourteen layouts on
 * every mount. Two things were wrong with that, and the second is the one that
 * settled it:
 *
 *  - it is a request per screen visit for data that changes only when this
 *    browser changes it;
 *  - a grid could no longer be rendered on its own. Every existing grid test
 *    mocks `fetch` for exactly the requests its screen makes, and several
 *    sequence the answers — so a second, unexpected request either consumed a
 *    queued response or read a body the list query needed. Thirty-five tests
 *    failed, and the symptom was an empty grid rather than anything about
 *    preferences.
 *
 * With the fetch here, a grid rendered outside this provider — which is what a
 * focused test is — simply uses its own defaults and asks the server nothing.
 * That is the correct behaviour for a preference, not a concession to tests: a
 * column layout is a convenience, and a screen must render without one.
 */

interface GridPreferencesValue {
  preferences: Map<string, GridColumnPreference[]>;
  isReady: boolean;
  save: (gridKey: string, columns: GridColumnDefault[]) => Promise<void>;
  reset: (gridKey: string) => Promise<void>;
  isSaving: boolean;
}

const EMPTY: GridPreferencesValue = {
  preferences: new Map(),
  isReady: true,
  save: async () => {},
  reset: async () => {},
  isSaving: false,
};

const GridPreferencesContext = createContext<GridPreferencesValue>(EMPTY);

const KEY = ["grid-preferences"] as const;

export function GridPreferencesProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();

  const query = useQuery({
    queryKey: KEY,
    // It changes only when this browser changes it, and the mutation below
    // writes the new value straight into the cache.
    staleTime: Infinity,
    queryFn: ({ signal }) =>
      apiRequest<GridPreferencesResponse>("/grid-preferences", {
        schema: gridPreferencesResponseSchema,
        signal,
      }),
  });

  const mutation = useMutation({
    mutationFn: async (input: { gridKey: string; columns: GridColumnDefault[] | null }) => {
      if (input.columns === null) {
        await apiRequest(`/grid-preferences/${input.gridKey}`, {
          method: "DELETE",
          schema: z.undefined(),
        });
        return input;
      }
      await apiRequest(`/grid-preferences/${input.gridKey}`, {
        method: "PUT",
        body: { columns: toGridPreference(input.columns) },
        schema: z.unknown(),
      });
      return input;
    },
    /**
     * The cache is written by hand rather than invalidated. Invalidating would
     * refetch every layout to learn something this browser already knows, and it
     * would land after the panel had closed — so the grid would visibly re-lay
     * itself out a moment later.
     */
    onSuccess: ({ gridKey, columns }) => {
      client.setQueryData<GridPreferencesResponse>(KEY, (current) => {
        const rows = (current?.rows ?? []).filter((row) => row.gridKey !== gridKey);
        return columns === null
          ? { rows }
          : { rows: [...rows, { gridKey, columns: toGridPreference(columns) }] };
      });
    },
  });

  const preferences = useMemo(
    () => new Map((query.data?.rows ?? []).map((row) => [row.gridKey, row.columns])),
    [query.data],
  );

  const save = useCallback(
    async (gridKey: string, columns: GridColumnDefault[]) => {
      await mutation.mutateAsync({ gridKey, columns });
    },
    [mutation],
  );

  const reset = useCallback(
    async (gridKey: string) => {
      await mutation.mutateAsync({ gridKey, columns: null });
    },
    [mutation],
  );

  const value = useMemo<GridPreferencesValue>(
    () => ({
      preferences,
      // A failed fetch does not hold a grid back: the defaults are perfectly
      // usable, and someone who cannot reach this endpoint has larger problems
      // than their column order.
      isReady: !query.isPending,
      save,
      reset,
      isSaving: mutation.isPending,
    }),
    [preferences, query.isPending, save, reset, mutation.isPending],
  );

  return (
    <GridPreferencesContext.Provider value={value}>{children}</GridPreferencesContext.Provider>
  );
}

export const useGridPreferencesContext = (): GridPreferencesValue =>
  useContext(GridPreferencesContext);
