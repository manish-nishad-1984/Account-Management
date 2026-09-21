import { useCallback, useState } from "react";
import { useOptionalAuth } from "../contexts/AuthContext";

/**
 * How many rows a grid shows at once, and the fact that it is the reader's
 * choice rather than ours.
 *
 * Asked for on 16 Sep 2026: every grid offers **5 to 100 in steps of 5**.
 * It opens at **5** (client request, 18 Sep 2026; it was 20). The reports are
 * not grids in this sense and page by 50 on their own. Someone who has already
 * picked a size keeps it: the default is only for a person who never chose. The .NET grids each hard-coded their own figure — 10 on some
 * screens, 25 on others, "all" on three — so the same person met a different
 * amount of scrolling on every screen and could change it on none of them.
 *
 * STEPS OF FIVE, twenty options, at the client's request (the first list was
 * 20/30/40/50/100). It is more than a menu usually wants, and it is the right
 * call here: the small end is the half that was missing. Five rows is a screen
 * someone can photograph or read out over a phone, and this is a construction
 * business whose site staff do exactly that.
 *
 * 100 IS THE CEILING, and the API's own `MAX_PAGE_SIZE` is 200. The gap is
 * deliberate: a 200-row page is four screens of scrolling to reach a pager, and
 * anyone who wants all of it wants a report rather than a grid. Raising the
 * ceiling here is safe as far as the server is concerned; making the grid
 * pleasant to read is the constraint that is actually binding.
 *
 * NOT `DEFAULT_PAGE_SIZE` from contracts, which stays 25. That constant is the
 * limit the API applies when a caller sends none, so moving it would change the
 * answer for every client of the HTTP API, not just this screen — a server-side
 * change to satisfy a UI request, which is exactly the swap not to make quietly.
 * The web app always sends an explicit `limit`, so the two never disagree in
 * practice.
 */
export const PAGE_SIZE_OPTIONS = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
] as const;

export const DEFAULT_GRID_PAGE_SIZE = 5;

const storageKey = (userId: string | null) => `accountbook.gridPageSize.${userId ?? "anonymous"}`;

/** Storage can throw — a private window, or a browser set to block site data. */
function readStored(userId: string | null): number | null {
  try {
    const value = Number(window.localStorage.getItem(storageKey(userId)));
    // A stored size that is no longer offered is discarded rather than honoured:
    // the list is what the control can show, and a value outside it would leave
    // the select with nothing selected.
    return PAGE_SIZE_OPTIONS.includes(value as (typeof PAGE_SIZE_OPTIONS)[number])
      ? value
      : null;
  } catch {
    return null;
  }
}

function writeStored(userId: string | null, size: number): void {
  try {
    window.localStorage.setItem(storageKey(userId), String(size));
  } catch {
    // A preference that cannot be remembered is not a reason to fail a render.
  }
}

/**
 * ONE SETTING FOR EVERY GRID, remembered per person in local storage.
 *
 * Per-grid was the other option and is worse on both counts: it is thirteen
 * things to set instead of one, and the preference is not really about a screen
 * — someone on a 27-inch display wants 50 rows everywhere, and someone on a
 * laptop wants 20 everywhere. Column layouts ARE per-grid, and those are stored
 * on the server; this is not, because it describes the display in front of the
 * person rather than the person, in the same way the collapsed rail does.
 *
 * Keyed by user because a browser at a site desk is shared, and the second
 * person to sign in should not inherit the first one's page.
 */
export function useGridPageSize(initial = DEFAULT_GRID_PAGE_SIZE): {
  pageSize: number;
  setPageSize: (size: number) => void;
} {
  const userId = useOptionalAuth()?.user?.id ?? null;
  const [pageSize, setSize] = useState(() => readStored(userId) ?? initial);

  const setPageSize = useCallback(
    (size: number) => {
      writeStored(userId, size);
      setSize(size);
    },
    [userId],
  );

  return { pageSize, setPageSize };
}
