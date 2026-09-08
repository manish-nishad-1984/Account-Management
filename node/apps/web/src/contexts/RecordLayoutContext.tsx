import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * How a record is opened: over the list, or beside it.
 *
 * THIS EXISTS TO SETTLE A QUESTION, NOT TO BE A FEATURE.
 *
 * The legacy screens are master-detail: click a row and the right pane fills.
 * No modal, and the list stays usable — a user can walk down it reading records
 * one after another. The port opened with a full-width grid and a modal that
 * blocks the list. That is a real change to how the screen is worked, not a
 * cosmetic one: better for editing a single record, clearly worse for browsing
 * a hundred.
 *
 * `19-Business-Decisions-Required.md` asks the business to choose, and a
 * description of two layouts is a poor way to ask. So both are here, switchable
 * from the header, on their own data — and whichever wins, the loser is deleted
 * rather than left as a setting nobody understands.
 *
 * The whole mechanism is three shared files. No screen knows about it:
 *
 *   - `FormDialog` renders a `Modal` or a `SidePanel`.
 *   - `useMasterScreen` adds row-click and selection to `gridProps` in split
 *     mode, and every page already spreads that object.
 *   - `AppShell` reserves the width while a pane is open.
 *
 * That is the same reason it must be decided NOW rather than after five more
 * screens: it costs three files today because the machinery is shared, and it
 * costs five screens' worth of rework once it is not.
 */
export type RecordLayout = "modal" | "split";

export interface RecordLayoutValue {
  layout: RecordLayout;
  setLayout: (layout: RecordLayout) => void;
  /**
   * True while a docked pane is on screen, so the shell can make room for it.
   *
   * Set by the pane itself rather than derived from any screen's state: only the
   * pane knows whether it actually rendered, and a shell that guesses ends up
   * reserving space beside a form that closed.
   */
  paneOpen: boolean;
  setPaneOpen: (open: boolean) => void;
}

/**
 * MODAL OUTSIDE A PROVIDER, deliberately.
 *
 * That is the behaviour every screen shipped with, so a component rendered
 * without the shell — including every existing test — behaves exactly as it did
 * before this existed. A context that threw here would turn one shared change
 * into 177 test edits, which is how a reversible experiment stops being
 * reversible.
 */
const FALLBACK: RecordLayoutValue = {
  layout: "modal",
  setLayout: () => {},
  paneOpen: false,
  setPaneOpen: () => {},
};

const RecordLayoutContext = createContext<RecordLayoutValue>(FALLBACK);

export const useRecordLayout = (): RecordLayoutValue => useContext(RecordLayoutContext);

const storageKey = (userId: string | null) => `accountbook.recordLayout.${userId ?? "anonymous"}`;

/** Reads the stored preference. Storage can throw — a private window, or blocked cookies. */
function readStored(userId: string | null): RecordLayout | null {
  try {
    const value = window.localStorage.getItem(storageKey(userId));
    return value === "modal" || value === "split" ? value : null;
  } catch {
    return null;
  }
}

function writeStored(userId: string | null, layout: RecordLayout): void {
  try {
    window.localStorage.setItem(storageKey(userId), layout);
  } catch {
    // A preference that cannot be remembered is not a reason to fail a render.
  }
}

export function RecordLayoutProvider({
  userId,
  children,
  initialLayout,
}: {
  userId: string | null;
  children: ReactNode;
  /** For tests and stories. Ignored once the user has chosen. */
  initialLayout?: RecordLayout;
}) {
  const [layout, setLayoutState] = useState<RecordLayout>(
    () => readStored(userId) ?? initialLayout ?? "modal",
  );
  const [paneOpen, setPaneOpen] = useState(false);

  const setLayout = useCallback(
    (next: RecordLayout) => {
      setLayoutState(next);
      writeStored(userId, next);
      // Switching layout closes whatever was open: the same record rendered into
      // the other container would keep half-typed values and look like a bug.
      setPaneOpen(false);
    },
    [userId],
  );

  const value = useMemo(
    () => ({ layout, setLayout, paneOpen, setPaneOpen }),
    [layout, setLayout, paneOpen],
  );

  return <RecordLayoutContext.Provider value={value}>{children}</RecordLayoutContext.Provider>;
}

/** Fixes the layout for a test or a story, with no storage involved. */
export function StaticRecordLayout({
  layout = "modal",
  children,
}: {
  layout?: RecordLayout;
  children: ReactNode;
}) {
  const [paneOpen, setPaneOpen] = useState(false);
  const value = useMemo(
    () => ({ layout, setLayout: () => {}, paneOpen, setPaneOpen }),
    [layout, paneOpen],
  );
  return <RecordLayoutContext.Provider value={value}>{children}</RecordLayoutContext.Provider>;
}
