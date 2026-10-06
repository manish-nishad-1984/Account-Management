import { useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import clsx from "clsx";
import {
  CalendarDays,
  ChevronRight,
  LogOut,
  Menu,
  Settings,
  X,
} from "lucide-react";
import { financialYear } from "@accountmanagement/domain";
import { hasPermission } from "@accountmanagement/contracts";
import { useAuth } from "../contexts/AuthContext";
import { NAV, SETTINGS_SECTION } from "../navigation/nav";
import { SECTION_TAB_ACTIONS_ID } from "./section-tab-slot";
import { IconButton, Tooltip } from "./ui/icon-button";
import { SiteScopePicker } from "./SiteScopePicker";
import { RecordLayoutPicker } from "./RecordLayoutPicker";
import { useRecordLayout } from "../contexts/RecordLayoutContext";

/**
 * Account Book shell: a narrow module rail, a slim top bar, and the routed page on a soft neutral ground.
 *
 * THE RAIL IS LIGHT, and that is the largest single change of the redesign. It
 * was a near-black navy column, which is a fine look and the wrong one here: it
 * put the heaviest object on the screen permanently in the reader's periphery,
 * and it meant the application had two colour systems - one for the rail and one
 * for everything else - so a component could not simply be moved between them.
 * One surface family now, white to #f7f7f8, with sky doing the work of saying
 * what is selected.
 *
 * Screens not yet migrated stay visible but muted and marked, so the rail
 * doubles as a readable record of migration progress rather than hiding work.
 */

/**
 * Sections that hold exactly one screen in `NAV` itself. The rail names such a
 * row after the screen ("Dashboard"), not the section ("Overview"). Worked out
 * from `NAV`, not from what a user may see, so a row does not rename itself
 * just because someone holds one of the rights in it.
 */
const SINGLE_SCREEN_SECTIONS = new Set(
  NAV.filter((section) => section.items.length === 1).map((section) => section.title),
);

type Section = (typeof NAV)[number];

const sectionLabel = (section: Section) =>
  SINGLE_SCREEN_SECTIONS.has(section.title) ? section.items[0]!.label : section.title;

/**
 * The section a route belongs to: an exact match, or a child of a screen's path
 * (`/purchase-orders/abc` is Purchase Orders). The Dashboard is `/`, which is a
 * prefix of everything, so it only ever matches exactly.
 */
function findSection<T extends Section>(sections: T[], pathname: string): T | undefined {
  let best: { section: T; length: number } | undefined;
  for (const section of sections) {
    for (const item of section.items) {
      const hit =
        item.to === pathname || (item.to !== "/" && pathname.startsWith(`${item.to}/`));
      if (hit && (!best || item.to.length > best.length)) {
        best = { section, length: item.to.length };
      }
    }
  }
  return best?.section;
}

/**
 * THE OTHER SCREENS OF THIS SECTION, as tabs across the top of the page.
 *
 * What the rail no longer lists. Shown only when the section has two or more
 * screens the user may open, since a lone tab would just repeat the breadcrumb.
 */
function SectionTabs({ section }: { section: Section | undefined }) {
  if (!section || section.items.length < 2) return null;

  /*
    SEGMENTED PILLS WITH THE SCREEN'S OWN ICON (client request, 5 Oct 2026:
    "make the tabs look better"). The active tab is a raised white pill on a
    grey track, which reads as selected from across the room where a 2px
    underline did not; the icon is the one the screen already has in the
    navigation, so a tab is recognised before it is read.

    `overflow-y-hidden` IS NOT OPTIONAL. `overflow-x-auto` makes the other axis
    `auto` too, and the old underline tabs hung 1px below the bar (`-mb-px`), so
    the browser drew a tiny vertical scrollbar at the right-hand end of the row -
    two scrollbars on a screen that was fitted to have one.
  */
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
    <nav aria-label={`${section.title} screens`} className="max-w-full overflow-x-auto overflow-y-hidden">
      <ul className="inline-flex min-w-max gap-0.5 rounded-lg bg-slate-200/70 p-0.5">
        {section.items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end
                className={({ isActive }) =>
                  clsx(
                    "flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500",
                    isActive
                      ? "bg-white text-brand-700 shadow-sm ring-1 ring-slate-300/70"
                      : "text-slate-600 hover:bg-white/60 hover:text-slate-900",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon aria-hidden className={clsx("size-4 shrink-0", isActive ? "text-brand-600" : "text-slate-400")} />
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
    <div id={SECTION_TAB_ACTIONS_ID} className="flex flex-wrap items-center gap-2" />
    </div>
  );
}

/**
 * Where you are, in the top bar: `Masters > Companies`.
 *
 * BACK IN THE HEADER at the client's request (16 Sep 2026). The redesign had
 * moved it into `PageHeader`, on the reasoning that a trail reads best directly
 * above the title it qualifies. The people using the screens want it in the bar,
 * which is where the .NET app puts it and where they look for it - and that is
 * the better argument, because it is the one from use.
 *
 * DERIVED, NOT PASSED. Both halves come out of `NAV`, the same list the rail is
 * built from and the same list `App` builds its routes from, so a screen that is
 * renamed or moves between sections is right here with no edit. Every route
 * inside the shell is a `NAV` entry, so the lookup always hits; anything else
 * (`/print/...`) renders outside the shell and never reaches this.
 *
 * The SECTION is what gives way when the bar runs out of room, not the page
 * name: "Companies" on its own still says where you are, "Masters >" on its own
 * says nothing.
 */
function Breadcrumb() {
  const { pathname } = useLocation();
  const section = NAV.find((group) => group.items.some((item) => item.to === pathname));
  const current = section?.items.find((item) => item.to === pathname);
  if (!section || !current) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
      <span className="hidden shrink-0 text-sm text-slate-500 sm:inline">
        {section.title}
      </span>
      <ChevronRight aria-hidden className="hidden size-3.5 shrink-0 text-slate-300 sm:block" />
      {/*
        The page's own name, lightly highlighted (client request, 18 Sep 2026):
        with the titles gone from the pages, this is where a page says what it is.
      */}
      <span
        aria-current="page"
        className="truncate rounded-md bg-brand-50 px-2 py-0.5 text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-100"
      >
        {current.label}
      </span>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { paneOpen, pageOpen, setPageHost } = useRecordLayout();

  const initials = (user?.userName ?? "?").slice(0, 2).toUpperCase();
  const fy = financialYear.format(financialYear.currentAsProduced(new Date()));

  /**
   * ONLY THE SCREENS THIS USER CAN ACTUALLY OPEN.
   *
   * Every nav entry has carried a `permission` since the navigation was written
   * and nothing read it, so the sidebar offered all seventeen screens to
   * everyone. Two of them answer 403 for a real production user - the reports,
   * whose forms are deliberately inactive - and following those links produced a
   * fully drawn page with "could not be loaded" on it, which reads as a fault to
   * retry rather than a door that is closed.
   *
   * This is presentation only. `PermissionsGuard` refuses the request again on
   * the server, which is the difference from the .NET app, where the Razor
   * partial was the only check.
   *
   * A section whose every item is hidden hides its heading too - otherwise the
   * rail grows an empty "REPORTS" label with nothing under it.
   */
  const allowed = useMemo(() => {
    const granted = user?.permissions ?? [];
    return NAV.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.permission || hasPermission(granted, item.permission, "view"),
      ),
    })).filter((section) => section.items.length > 0);
  }, [user?.permissions]);

  // Settings are the gear in the top bar, not a section of the rail.
  const nav = useMemo(
    () => allowed.filter((section) => section.title !== SETTINGS_SECTION),
    [allowed],
  );
  const settingsItems = useMemo(
    () => allowed.find((section) => section.title === SETTINGS_SECTION)?.items ?? [],
    [allowed],
  );

  const { pathname } = useLocation();
  /** The section the route is in, for the lit rail row and the tabs. */
  const currentSection = findSection(nav, pathname);

  return (
    <div className="flex h-full bg-app">
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          aria-hidden
        />
      )}

      {/*
        A NARROW RAIL, ALWAYS - the Keshav app's layout, at the client's request
        (5 Oct 2026): 88px wide on a desktop, each section an icon over a short
        label, and nothing to open or close. It had a collapse control and two
        widths; with one row per section the long form has nothing left to
        show, and the control was the part the client did not want to need.

        Below `lg` it is the phone drawer: 232px, off-canvas, rows laid out
        icon-then-label the way a menu reads on a small screen.
      */}
      <aside
        id="app-sidebar"
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-[232px] shrink-0 flex-col",
          "border-r border-slate-200 bg-white",
          "transition-transform duration-200 ease-out",
          "lg:static lg:w-[5.5rem] lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-slate-200 px-3 lg:justify-center lg:px-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
            AB
          </div>
          <div className="min-w-0 leading-tight lg:hidden">
            <div className="truncate text-sm font-semibold text-slate-900">Account Book</div>
            <div className="truncate text-xs text-slate-500">D H Infra</div>
          </div>

          {/* A phone's way out of the drawer. A desktop has no drawer. */}
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
            /*
             * A 40px box, not the 28px this was. It only ever appears on a phone,
             * where it is hit with a thumb - and it was the smallest control in
             * the application. The icon stays the same size; the padding grows.
             */
            className="ml-auto rounded-md p-3 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="scroll-subtle flex-1 overflow-y-auto px-2.5 py-3 lg:px-1" aria-label="Main">
          {/*
            ONE ROW PER SECTION, NOT PER SCREEN (client request, 5 Oct 2026: the
            rail listed twenty entries). A row goes to the first screen of its
            section, and the section's other screens are the tabs across the top
            of the page (see `SectionTabs`).

            Two earlier attempts at this - folders that open in the rail, first
            one at a time and then each on its own - were both turned down, so
            the rail has no children at all and nothing in it expands.
          */}
          <ul className="space-y-1">
            {nav.map((section) => {
              const Icon = section.icon;
              const label = sectionLabel(section);
              const active = section.title === currentSection?.title;
              return (
                <li key={section.title}>
                  <Link
                    to={section.items[0]!.to}
                    onClick={() => setSidebarOpen(false)}
                    /*
                     * Active is the SECTION the route belongs to, not whether
                     * this row's own path matches: on "Sites" the Masters row
                     * links to "Companies" and is still the one that is lit.
                     * A plain Link, because NavLink computes its own
                     * aria-current from the row's path and would drop this one.
                     */
                    aria-current={active ? "page" : undefined}
                    className={clsx(
                      "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                      "lg:flex-col lg:gap-1 lg:px-0.5 lg:text-[11px]",
                      active
                        ? "bg-brand-50 font-semibold text-brand-700 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-brand-600"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                    )}
                  >
                    <Icon aria-hidden className="size-5 shrink-0" strokeWidth={active ? 1.9 : 1.6} />
                    <span className="truncate lg:w-full lg:text-center lg:leading-tight">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="shrink-0 border-t border-slate-200 p-2.5">
          <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 lg:flex-col lg:gap-1 lg:px-0">
            <div
              title={user?.userName}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100"
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1 leading-tight lg:hidden">
              <div className="truncate text-sm font-medium text-slate-900">
                {user?.userName}
              </div>
              <div className="truncate text-xs text-slate-500">
                {user?.permissions.length ?? 0} permissions
              </div>
            </div>
            {/*
              36px, and it stays 36px with a mouse. Sign out sits next to nothing
              else, so a small target is both easy to miss and easy to hit by
              accident on the way past - the reason the old 28px version carried
              a touch-only override, which this size makes unnecessary.
            */}
            <IconButton
              label="Sign out"
              icon={LogOut}
              size="md"
              onClick={() => void logout()}
            />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          44px (it was 56 - client request, 5 Oct 2026: too tall), opaque white,
          one hairline under it. The 36px controls in it keep 4px above and below.

          One job on each side: say where you are on the left, say whose data is
          on screen on the right. The left gives way when width runs short and
          the right does not - see the note on the scope picker below.
        */}
        <header className="sticky top-0 z-20 flex h-11 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
              className="-ml-1 shrink-0 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:hidden"
            >
              <Menu className="size-4" />
            </button>

            <Breadcrumb />
          </div>

          {/*
            This side does NOT give way. The scope picker says whose data is on
            screen, and a reader who cannot see it is reading numbers without
            knowing which site they belong to.
          */}
          <div className="flex shrink-0 items-center gap-2">
            <RecordLayoutPicker />

            <SiteScopePicker />

            {/* The financial year yields the width on a phone; the site does not. */}
            <div className="hidden h-9 items-center gap-2 rounded-lg bg-slate-50 px-2.5 ring-1 ring-inset ring-slate-200 sm:flex">
              <CalendarDays aria-hidden className="size-3.5 text-slate-400" />
              <span className="hidden text-xs text-slate-500 lg:inline">Financial year</span>
              <span className="tabular text-xs font-semibold text-slate-800">{fy}</span>
            </div>

            {/*
              SETTINGS LIVE HERE, not in the rail (client request: too many menu
              entries). One screen today, so the gear goes straight to it; with
              more, it is the place to turn into a menu. Absent entirely for
              someone who may open none of them, rather than a gear that leads to
              a locked page.
            */}
            {settingsItems[0] && (
              <Tooltip label="Settings">
                <NavLink
                  to={settingsItems[0].to}
                  aria-label="Settings"
                  className={({ isActive }) =>
                    clsx(
                      "inline-flex size-9 items-center justify-center rounded-lg transition-colors",
                      isActive
                        ? "bg-brand-50 text-brand-700"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
                    )
                  }
                >
                  <Settings aria-hidden className="size-4" />
                </NavLink>
              </Tooltip>
            )}
          </div>
        </header>

        {/*
          Room for the docked record, and only while one is open.

          The pane is `position: fixed`, so without this it would sit ON TOP of
          the right-hand columns of the grid - which would look like the split
          layout while hiding exactly the data the split layout exists to keep
          visible. Narrow screens get no padding: there the pane is full width
          and covering the list is the only thing it can do.
        */}
        <main
          className={clsx(
            // `relative` so an absolutely positioned child (every `sr-only` label) is
            // clipped by THIS scroller. Without it the label's containing block was
            // the page, and one below the fold of a long form stretched the document
            // and gave the window a second vertical scrollbar.
            "relative flex-1 overflow-y-auto py-6 transition-[padding] duration-200",
            "pl-4 lg:pl-8",
            /*
             * The right padding is expressed ONCE, as one class or the other.
             *
             * It was written as a base `lg:px-8` plus a conditional
             * `sm:pr-[29rem]`, and the conditional lost: Tailwind emits `sm:`
             * rules before `lg:` ones, so at desktop width `lg:px-8` overrode
             * it and the padding stayed 32px. The pane then sat ON TOP of 415px
             * of the list - the layout looked right in a screenshot and defeated
             * its own purpose. Measured in a real browser, not reasoned about.
             */
            paneOpen ? "pr-4 sm:pr-[29rem]" : "pr-4 lg:pr-8",
          )}
        >
          {/*
            Where a record goes when it takes the page.

            It is a SIBLING of the routed page rather than a part of it, because
            the element below is about to be hidden and the form that renders
            into this one is written by the screen inside it. See `pageHost` in
            `RecordLayoutContext` for why this is a portal target and not a
            `fixed` overlay covering the content area.

            Rendered ALWAYS, empty almost all of the time. A host that appeared
            only once a record was open would not yet exist at the moment the
            record asked where to go, and the first click would open nothing.
          */}
          {/*
            As tall as the window while a record has the page, so the record's
            Cancel / Save footer can sit at the bottom of a SHORT form instead of
            just under its last field. Without it this div is only as tall as its
            content, and `min-h-full` on the page inside it has nothing to be a
            percentage of - the footer floated under the supplier form and moved
            whenever a section changed height.
          */}
          <div ref={setPageHost} className={clsx(pageOpen && "flex min-h-full flex-col")} />

          {/*
            FULL WIDTH, no 1280px cap.

            `max-w-7xl` centred every page in 1280px and left the rest of the
            window empty, which on a 1920px screen is a third of the display
            spent on margins while the grids underneath were scrolling
            sideways. The client asked for the width and the grids are the
            reason: 640px of unused desk is what a wide monitor was bought for.

            HIDDEN, NOT UNMOUNTED, while a record has the page. The list keeps
            its search, its sort, its cursor and its loaded rows, so the back
            arrow returns to the screen the user left rather than to a fresh one
            that has to fetch itself again - which is the difference between a
            drill-down and a round trip.

            The ATTRIBUTE, not a `hidden` class. `[hidden]` is display:none in
            every browser's own stylesheet, so this does not depend on Tailwind
            having emitted anything, and it is the markup that actually means
            "not currently relevant" - which is what takes the list out of the
            accessibility tree, so a screen reader is not offering a hundred rows
            that are not on screen.
          */}
          <div hidden={pageOpen}>
            <SectionTabs section={currentSection} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
