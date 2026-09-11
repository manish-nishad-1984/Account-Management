import { useCallback, useMemo } from "react";
import { resolveGridColumns, type GridColumnDefault } from "@accountmanagement/contracts";
import { useGridPreferencesContext } from "../contexts/GridPreferencesContext";

export interface GridPreferenceState {
  /** The grid's columns, reconciled with whatever this person saved. */
  columns: GridColumnDefault[];
  save: (columns: GridColumnDefault[]) => Promise<void>;
  reset: () => Promise<void>;
  isSaving: boolean;
}

/**
 * One grid's column layout.
 *
 * `defaults` is the grid's statement of what columns exist TODAY; what is stored
 * is a snapshot of what existed when this person last pressed Save.
 * `resolveGridColumns` reconciles the two — see its comment for why a column
 * added after a layout was saved is the case that bites.
 *
 * Outside `GridPreferencesProvider` this returns the defaults and saving does
 * nothing, so a grid renders correctly on its own.
 */
export function useGridPreferences(
  gridKey: string,
  defaults: readonly GridColumnDefault[],
): GridPreferenceState {
  const context = useGridPreferencesContext();
  const saved = gridKey ? (context.preferences.get(gridKey) ?? null) : null;

  const columns = useMemo(() => resolveGridColumns(defaults, saved), [defaults, saved]);

  const save = useCallback(
    async (next: GridColumnDefault[]) => {
      if (gridKey) await context.save(gridKey, next);
    },
    [context, gridKey],
  );

  const reset = useCallback(async () => {
    if (gridKey) await context.reset(gridKey);
  }, [context, gridKey]);

  return { columns, save, reset, isSaving: context.isSaving };
}
