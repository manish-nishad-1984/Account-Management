import { z } from "zod";

/**
 * Per-person column layout for a grid: which columns are shown, and in what
 * order.
 *
 * ONE ARRAY CARRIES BOTH, in display order, because the panel edits both at once
 * and two separate fields could disagree — a column present in the order but
 * missing from the visible set has no defined meaning, and someone would have to
 * invent one at read time.
 *
 * The ids are the grid's own column ids, which are stable and already used for
 * sorting, so nothing new has to be kept in step.
 */

export const gridColumnPreferenceSchema = z.object({
  id: z.string().min(1).max(64),
  visible: z.boolean(),
});
export type GridColumnPreference = z.infer<typeof gridColumnPreferenceSchema>;

/**
 * A grid key is the screen's own slug — "suppliers", "purchase-invoices".
 * Constrained because it goes into a primary key and comes from the client.
 */
export const gridKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "A grid key is lower-case letters, digits and hyphens");

export const gridPreferenceSchema = z.object({
  gridKey: gridKeySchema,
  /**
   * Capped so one person cannot store an unbounded blob under their own id. No
   * grid in the application is close to 100 columns.
   */
  columns: z.array(gridColumnPreferenceSchema).max(100),
});
export type GridPreference = z.infer<typeof gridPreferenceSchema>;

export const saveGridPreferenceSchema = gridPreferenceSchema.pick({ columns: true });
export type SaveGridPreference = z.infer<typeof saveGridPreferenceSchema>;

export const gridPreferencesResponseSchema = z.object({
  rows: z.array(gridPreferenceSchema),
});
export type GridPreferencesResponse = z.infer<typeof gridPreferencesResponseSchema>;

/** What a grid declares about one of its columns before any person touches it. */
export interface GridColumnDefault {
  id: string;
  /** Shown in the customise panel. */
  label: string;
  /** Whether it is shown when nobody has chosen anything. */
  visible: boolean;
  /**
   * A column that cannot be hidden or moved — the one that identifies the row,
   * and the row actions. The reference design locks its first column for the
   * same reason: a grid whose every column is hidden is a grid you cannot use.
   */
  locked?: boolean;
}

/**
 * THE MERGE RULE, and it is the whole reason this lives in the contract rather
 * than in the browser.
 *
 * A saved preference is a snapshot of the columns that existed the day it was
 * saved. The application keeps changing: columns get added, and occasionally one
 * is removed. So a stored layout is never simply trusted, it is reconciled:
 *
 *  - a column the person ordered and still exists keeps its place;
 *  - a column that no longer exists is dropped, rather than leaving a hole;
 *  - a column added to the grid SINCE the layout was saved is appended at the
 *    end with its default visibility, rather than vanishing because an old
 *    preference did not mention it. That last one is the case that bites: it is
 *    silent, and it looks like the new column was never built.
 *
 * A LOCKED COLUMN IS PINNED TO ITS OWN POSITION, not moved to the front. The
 * first version pushed every locked column to the front so the identity column
 * would lead — which also dragged the row-actions column from the last position
 * to the second, putting Edit and Delete in the middle of the data. Each locked
 * column keeps the index the grid declares for it, and the chosen columns fill
 * the gaps between them in the order the person put them.
 *
 * Locked columns are also forced back to visible, whatever a stored layout says,
 * including one saved before a column became locked.
 */
export function resolveGridColumns(
  defaults: readonly GridColumnDefault[],
  saved: readonly GridColumnPreference[] | null | undefined,
): GridColumnDefault[] {
  const byId = new Map(defaults.map((column) => [column.id, column]));
  const lockedIds = new Set(defaults.filter((c) => c.locked).map((c) => c.id));

  if (!saved || saved.length === 0) {
    return defaults.map((column) => ({ ...column }));
  }

  // The movable columns, in the order this person put them.
  const movable: GridColumnDefault[] = [];
  const placed = new Set<string>();

  for (const entry of saved) {
    const column = byId.get(entry.id);
    if (!column || lockedIds.has(entry.id) || placed.has(entry.id)) continue;
    movable.push({ ...column, visible: entry.visible });
    placed.add(entry.id);
  }

  // Anything the saved layout never mentioned is new since it was written.
  for (const column of defaults) {
    if (placed.has(column.id) || lockedIds.has(column.id)) continue;
    movable.push({ ...column });
    placed.add(column.id);
  }

  // Walk the grid's own order, keeping each locked column where it belongs and
  // drawing the rest, in the chosen order, from the queue.
  const queue = [...movable];
  const result: GridColumnDefault[] = [];
  for (const column of defaults) {
    if (column.locked) {
      result.push({ ...column, visible: true });
    } else {
      const next = queue.shift();
      if (next) result.push(next);
    }
  }
  // Defensive: cannot happen while `defaults` and `movable` are the same length.
  result.push(...queue);

  return result;
}

/** What gets sent back to the server: the resolved layout, minus the labels. */
export function toGridPreference(
  columns: readonly GridColumnDefault[],
): GridColumnPreference[] {
  return columns.map((column) => ({ id: column.id, visible: column.visible }));
}

/**
 * Moving one column to another position, which is the only edit the drag handle
 * and the keyboard buttons both make.
 *
 * Pure and exported so it is tested directly: drag-and-drop is close to
 * untestable in a headless DOM, so the logic must not live inside the handler.
 */
export function moveGridColumn<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}
