import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * How a record is opened: over the list, beside it, or instead of it.
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
 * description of the layouts is a poor way to ask. So all three are here,
 * switchable from the header, on their own data — and whichever wins, the losers
 * are deleted rather than left as a setting nobody understands.
 *
 * THE THIRD OPTION ANSWERS WHAT THE OTHER TWO BOTH GIVE UP: ROOM.
 *
 * `modal` and `split` each show the record in a box on top of, or beside, the
 * list — 48rem of dialog, or 28rem of panel. The forms that hurt are the ones
 * that fit neither: the purchase order's eight-column line grid already scrolls
 * sideways inside the widest modal there is, which puts the price and GST boxes
 * off screen while you are typing the line they belong to. `page` gives the
 * record the whole content area and sends the list behind a back arrow — the
 * drill-down every user already knows from a phone.
 *
 * What it pays for that room is exactly what the split layout exists to protect:
 * the list is not on screen, so records cannot be walked one after another
 * without going back each time. That is the trade the business is being asked to
 * weigh, and it is why a written description was never going to settle it.
 *
 * The whole mechanism is four shared files. No screen knows about it:
 *
 *   - `FormDialog` renders a `Modal`, a `SidePanel` or a `RecordPage`.
 *   - `useMasterScreen` adds row-click and selection to `gridProps`, and every
 *     page already spreads that object.
 *   - `AppShell` reserves the width beside a pane, and hosts the record page and
 *     hides the routed list under it.
 *   - `RecordPage` is the surface itself.
 *
 * That is the same reason it must be decided NOW rather than after five more
 * screens: it costs four files today because the machinery is shared, and it
 * costs five screens' worth of rework once it is not.
 */
export type RecordLayout = "modal" | "split" | "page";

const LAYOUTS = ["modal", "split", "page"] as const;

const isLayout = (value: unknown): value is RecordLayout =>
  (LAYOUTS as readonly unknown[]).includes(value);

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
  /**
   * True while a record has taken over the content area, so the shell can hide
   * the routed page underneath it.
   *
   * HIDDEN, NOT UNMOUNTED. The list keeps its search, its sort, its page cursor
   * and its loaded rows, so the back arrow returns to the screen the user left
   * rather than to a reset one that has to fetch itself again. `display: none`
   * also takes it out of the accessibility tree, so a screen reader is not
   * reading a hundred rows that are not on screen.
   */
  pageOpen: boolean;
  setPageOpen: (open: boolean) => void;
  /**
   * Where a record page renders: the element the shell reserves for it inside
   * the content area.
   *
   * A PORTAL RATHER THAN POSITIONING, because the alternative is worse. The form
   * is rendered by the screen, which sits inside the element the shell is about
   * to hide — so to survive that it has to leave. Covering the content area with
   * a `fixed` overlay instead would mean re-deriving the shell's own geometry
   * from outside it, and the sidebar is 16rem, or 4rem collapsed, or off-canvas
   * on a phone: three numbers that would then have two owners.
   *
   * Null when there is no shell — a test, a story. `FormDialog` renders in place
   * then, which is the honest fallback: no shell, nothing to hide.
   */
  pageHost: HTMLElement | null;
  setPageHost: (host: HTMLElement | null) => void;
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
  pageOpen: false,
  setPageOpen: () => {},
  pageHost: null,
  setPageHost: () => {},
};

const RecordLayoutContext = createContext<RecordLayoutValue>(FALLBACK);

export const useRecordLayout = (): RecordLayoutValue => useContext(RecordLayoutContext);

const storageKey = (userId: string | null) => `accountbook.recordLayout.${userId ?? "anonymous"}`;

/** Reads the stored preference. Storage can throw — a private window, or blocked cookies. */
function readStored(userId: string | null): RecordLayout | null {
  try {
    const value = window.localStorage.getItem(storageKey(userId));
    return isLayout(value) ? value : null;
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
  /*
   * FULL PAGE IS WHAT A NEW USER GETS (client's choice, 16 Sep 2026).
   *
   * It is "page" because that is the layout the full-width form work was done
   * for: sections as cards, three or four columns, a line grid that does not
   * scroll sideways. Left at "modal" a first sign-in would show the new paint
   * and none of the room.
   *
   * It is a starting point rather than the decision, because `RecordLayoutPicker`
   * ships to production again — it was briefly gated to development builds, and
   * the client asked for it back the same day. `readStored` therefore wins over
   * this line for anyone who has ever picked, which is the whole point of the
   * control being there.
   *
   * `FALLBACK` above stays "modal" — that is the no-provider case for the 177
   * tests that render a screen bare, and a different thing entirely.
   */
  const [layout, setLayoutState] = useState<RecordLayout>(
    () => readStored(userId) ?? initialLayout ?? "page",
  );
  const [paneOpen, setPaneOpen] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);
  const [pageHost, setPageHost] = useState<HTMLElement | null>(null);

  const setLayout = useCallback(
    (next: RecordLayout) => {
      setLayoutState(next);
      writeStored(userId, next);
      // Switching layout closes whatever was open: the same record rendered into
      // the other container would keep half-typed values and look like a bug.
      // Leaving `pageOpen` set would be worse than looking odd — the shell would
      // go on hiding the routed page with nothing rendered over it, and the user
      // would be staring at an empty content area with no way back.
      setPaneOpen(false);
      setPageOpen(false);
    },
    [userId],
  );

  const value = useMemo(
    () => ({
      layout,
      setLayout,
      paneOpen,
      setPaneOpen,
      pageOpen,
      setPageOpen,
      pageHost,
      setPageHost,
    }),
    [layout, setLayout, paneOpen, pageOpen, pageHost],
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
  const [pageOpen, setPageOpen] = useState(false);
  const [pageHost, setPageHost] = useState<HTMLElement | null>(null);
  const value = useMemo(
    () => ({
      layout,
      setLayout: () => {},
      paneOpen,
      setPaneOpen,
      pageOpen,
      setPageOpen,
      pageHost,
      setPageHost,
    }),
    [layout, paneOpen, pageOpen, pageHost],
  );
  return <RecordLayoutContext.Provider value={value}>{children}</RecordLayoutContext.Provider>;
}
