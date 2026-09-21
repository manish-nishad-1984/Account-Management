import { useCallback, useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import clsx from "clsx";
import {
  CalendarDays,
  ChevronRight,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { financialYear } from "@accountmanagement/domain";
import { hasPermission } from "@accountmanagement/contracts";
import { useAuth } from "../contexts/AuthContext";
import { NAV } from "../navigation/nav";
import { IconButton, Tooltip } from "./ui/icon-button";
import { SiteScopePicker } from "./SiteScopePicker";
import { RecordLayoutPicker } from "./RecordLayoutPicker";
import { useRecordLayout } from "../contexts/RecordLayoutContext";

/**
 * Account Book shell: a light module rail that collapses to icons, a slim top
 * bar, and the routed page on a soft neutral ground.
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

const collapseKey = (userId: string | null) =>
  `accountbook.sidebarCollapsed.${userId ?? "anonymous"}`;

/** Storage can throw - a private window, or a browser set to block site data. */
function readCollapsed(userId: string | null): boolean {
  try {
    return window.localStorage.getItem(collapseKey(userId)) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(userId: string | null, collapsed: boolean): void {
  try {
    window.localStorage.setItem(collapseKey(userId), String(collapsed));
  } catch {
    // A preference that cannot be remembered is not a reason to fail a render.
  }
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

  /**
   * COLLAPSING IS A DESKTOP IDEA, and every class that acts on it is an `lg:`
   * one.
   *
   * On a phone the rail is already off-canvas, and full width when open, so a
   * "collapsed" drawer would be a 64px column of icons laid over the page -
   * strictly worse than the drawer, and reachable only by someone who collapsed
   * it at a desk and then picked up their phone. The stored preference is
   * carried on both; only the wide layout acts on it.
   *
   * It is kept per person, in local storage rather than on the server, because
   * it describes this screen rather than this user: the same person wants the
   * rail open on a laptop and out of the way on a 13-inch display, and a
   * server-side preference would follow them between the two.
   */
  const [collapsed, setCollapsed] = useState(() => readCollapsed(user?.id ?? null));

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      writeCollapsed(user?.id ?? null, !current);
      return !current;
    });
  }, [user?.id]);

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
  const nav = useMemo(() => {
    const granted = user?.permissions ?? [];
    return NAV.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.permission || hasPermission(granted, item.permission, "view"),
      ),
    })).filter((section) => section.items.length > 0);
  }, [user?.permissions]);

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
        232px expanded, 64px collapsed. The rail carries five section headings
        and seventeen destinations; at the 256px this was, the longest label
        ("Ledger & Balances") still had 70px of air to its right on every screen.
      */}
      <aside
        id="app-sidebar"
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-[232px] shrink-0 flex-col",
          "border-r border-slate-200 bg-white",
          "transition-[transform,width] duration-200 ease-out",
          "lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          collapsed && "lg:w-16",
        )}
      >
        {/*
          THE COLLAPSE CONTROL LIVES HERE, in the brand block, at the client's
          request (16 Sep 2026). It was in the top bar, one breakpoint away from
          the hamburger, so that the same corner worked the navigation at every
          width. On the rail it is on the thing it collapses, which is the more
          obvious place to reach for - and it frees the top-left corner of the
          bar for the breadcrumb that moved there on the same day.

          COLLAPSED, THE BRAND MARK STANDS DOWN FOR IT. 64px holds one 32px
          square and no more, and a rail that cannot be reopened from its own
          header is worse than one with no logo in it. Little is lost: expanded
          is the default state, and the mark is the first thing in it.
        */}
        <div
          className={clsx(
            "flex h-14 shrink-0 items-center gap-2.5 border-b border-slate-200 px-3",
            collapsed && "lg:justify-center lg:gap-0 lg:px-0",
          )}
        >
          <div
            className={clsx(
              "flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white",
              collapsed && "lg:hidden",
            )}
          >
            AB
          </div>
          <div className={clsx("min-w-0 leading-tight", collapsed && "lg:hidden")}>
            <div className="truncate text-sm font-semibold text-slate-900">Account Book</div>
            <div className="truncate text-xs text-slate-500">D H Infra</div>
          </div>

          {/*
            Desktop only, and deliberately: on a phone the rail is off-canvas and
            full width, so a collapsed 64px column laid over the page would be
            strictly worse than the drawer. The X beside this is the phone's
            answer, and the two never show at the same time.
          */}
          <Tooltip label={collapsed ? "Expand navigation" : "Collapse navigation"}>
            <button
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              aria-expanded={!collapsed}
              aria-controls="app-sidebar"
              className={clsx(
                "hidden size-8 shrink-0 items-center justify-center rounded-lg",
                "text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                "lg:inline-flex",
                !collapsed && "ml-auto",
              )}
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden className="size-4" />
              ) : (
                <PanelLeftClose aria-hidden className="size-4" />
              )}
            </button>
          </Tooltip>

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

        <nav
          className={clsx(
            "scroll-subtle flex-1 overflow-y-auto px-2.5 py-3",
            collapsed && "lg:px-2",
          )}
          aria-label="Main"
        >
          {nav.map((section, sectionIndex) => (
            <div key={section.title} className="mb-4 last:mb-1">
              {/*
                Collapsed, the heading has nowhere to go: "MASTERS" does not fit
                in 64px, and truncating it to "MAS..." says less than nothing. A
                hairline keeps the grouping visible instead. It is skipped above
                the first section, where the brand block's own border already
                draws that line.
              */}
              {collapsed && sectionIndex > 0 && (
                <div aria-hidden className="mx-2 mb-2.5 hidden h-px bg-slate-200 lg:block" />
              )}
              <div
                className={clsx(
                  "mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400",
                  collapsed && "lg:hidden",
                )}
              >
                {section.title}
              </div>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const planned = item.status === "planned";
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === "/"}
                        onClick={() => setSidebarOpen(false)}
                        /*
                         * The label is hidden with `lg:hidden` rather than dropped
                         * from the tree, so the drawer on a phone still reads
                         * normally. Hidden text carries no accessible name, though,
                         * so the collapsed rail names each link itself - and says
                         * out loud which screens are not built yet, since those
                         * lose their "soon" badge to the narrower column.
                         */
                        aria-label={collapsed ? item.label : undefined}
                        title={
                          collapsed
                            ? planned
                              ? `${item.label} - not migrated yet`
                              : item.label
                            : undefined
                        }
                        className={({ isActive }) =>
                          clsx(
                            // 36px rows. Seventeen of them plus five headings is
                            // 780px, which fits a 13-inch laptop without the rail
                            // scrolling - the thing that made the old 40px rows
                            // worth changing.
                            "group flex h-9 items-center gap-2.5 rounded-lg px-2.5",
                            "text-sm transition-colors duration-150",
                            collapsed && "lg:justify-center lg:px-0",
                            isActive
                              ? "bg-brand-50 font-medium text-brand-700"
                              : planned
                                ? "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {/*
                              SKY WHEN SELECTED, neutral dark grey otherwise. The
                              pale fill alone is a weak signal at a glance down a
                              17-row list; the fill plus a coloured mark is not,
                              and neither is a coloured block.
                            */}
                            <Icon
                              aria-hidden
                              className={clsx(
                                "size-4 shrink-0 transition-colors",
                                isActive
                                  ? "text-brand-600"
                                  : planned
                                    ? "text-slate-300"
                                    : "text-slate-500 group-hover:text-slate-700",
                              )}
                            />
                            <span className={clsx("truncate", collapsed && "lg:hidden")}>
                              {item.label}
                            </span>
                            {planned && (
                              <span
                                title="Not migrated yet"
                                className={clsx(
                                  "ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400 ring-1 ring-inset ring-slate-200",
                                  collapsed && "lg:hidden",
                                )}
                              >
                                soon
                              </span>
                            )}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-slate-200 p-2.5">
          <div
            className={clsx(
              "flex items-center gap-2.5 rounded-lg px-1.5 py-1",
              collapsed && "lg:flex-col lg:gap-1 lg:px-0",
            )}
          >
            <div
              title={collapsed ? user?.userName : undefined}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100"
            >
              {initials}
            </div>
            <div className={clsx("min-w-0 flex-1 leading-tight", collapsed && "lg:hidden")}>
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
          56px, opaque white, one hairline under it.

          One job on each side: say where you are on the left, say whose data is
          on screen on the right. The left gives way when width runs short and
          the right does not - see the note on the scope picker below.
        */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:px-8">
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
            "flex-1 overflow-y-auto py-6 transition-[padding] duration-200",
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
          <div ref={setPageHost} />

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
          <div hidden={pageOpen}>{children}</div>
        </main>
      </div>
    </div>
  );
}
