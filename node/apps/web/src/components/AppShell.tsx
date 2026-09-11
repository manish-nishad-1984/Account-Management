import { useCallback, useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import clsx from "clsx";
import { CalendarDays, LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { financialYear } from "@accountmanagement/domain";
import { hasPermission } from "@accountmanagement/contracts";
import { useAuth } from "../contexts/AuthContext";
import { NAV } from "../navigation/nav";
import { SiteScopePicker } from "./SiteScopePicker";
import { RecordLayoutPicker } from "./RecordLayoutPicker";
import { useRecordLayout } from "../contexts/RecordLayoutContext";

/**
 * Account Book panel shell: a module rail that collapses to icons, a slim top
 * bar, and the routed page on a soft surface.
 *
 * Screens not yet migrated stay visible but dimmed and marked, so the panel
 * doubles as a readable record of migration progress rather than hiding work.
 */

const collapseKey = (userId: string | null) =>
  `accountbook.sidebarCollapsed.${userId ?? "anonymous"}`;

/** Storage can throw — a private window, or a browser set to block site data. */
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

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { paneOpen } = useRecordLayout();

  /**
   * COLLAPSING IS A DESKTOP IDEA, and every class that acts on it is an `lg:`
   * one.
   *
   * On a phone the rail is already off-canvas, and full width when open, so a
   * "collapsed" drawer would be a 64px column of icons laid over the page —
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
   * everyone. Two of them answer 403 for a real production user — the reports,
   * whose forms are deliberately inactive — and following those links produced a
   * fully drawn page with "could not be loaded" on it, which reads as a fault to
   * retry rather than a door that is closed.
   *
   * This is presentation only. `PermissionsGuard` refuses the request again on
   * the server, which is the difference from the .NET app, where the Razor
   * partial was the only check.
   *
   * A section whose every item is hidden hides its heading too — otherwise the
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
    <div className="flex h-full bg-slate-50">
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          aria-hidden
        />
      )}

      <aside
        id="app-sidebar"
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col",
          "bg-shell-900 transition-[transform,width] duration-200 ease-out",
          "lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          collapsed && "lg:w-16",
        )}
      >
        <div
          className={clsx(
            "flex h-16 items-center gap-3 border-b border-white/10 px-5",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-lg">
            AB
          </div>
          <div className={clsx("min-w-0 leading-tight", collapsed && "lg:hidden")}>
            <div className="truncate text-sm font-semibold text-white">Account Book</div>
            <div className="truncate text-[11px] text-slate-400">D H Infra</div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
            /*
             * A 40px box, not the 28px this was. It only ever appears on a phone,
             * where it is hit with a thumb — and it was the smallest control in
             * the application. The icon stays the same size; the padding grows.
             */
            className="ml-auto rounded-md p-3 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav
          className={clsx(
            "scroll-subtle flex-1 overflow-y-auto px-3 py-4",
            collapsed && "lg:px-2",
          )}
          aria-label="Main"
        >
          {nav.map((section, sectionIndex) => (
            <div key={section.title} className="mb-6 last:mb-2">
              {/*
                Collapsed, the heading has nowhere to go: "MASTERS" does not fit
                in 64px, and truncating it to "MAS…" says less than nothing. A
                hairline keeps the grouping visible instead. It is skipped above
                the first section, where the brand block's own border already
                draws that line.
              */}
              {collapsed && sectionIndex > 0 && (
                <div aria-hidden className="mx-2 mb-3 hidden h-px bg-white/10 lg:block" />
              )}
              <div
                className={clsx(
                  "mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500",
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
                         * so the collapsed rail names each link itself — and says
                         * out loud which screens are not built yet, since those
                         * lose their "soon" badge to the narrower column.
                         */
                        aria-label={collapsed ? item.label : undefined}
                        title={
                          collapsed
                            ? planned
                              ? `${item.label} — not migrated yet`
                              : item.label
                            : undefined
                        }
                        className={({ isActive }) =>
                          clsx(
                            "group relative flex items-center gap-2.5 rounded-lg px-3 py-2",
                            "text-sm transition-colors duration-150",
                            collapsed && "lg:justify-center lg:px-0",
                            isActive
                              ? "bg-white/10 font-medium text-white"
                              : planned
                                ? "text-slate-500 hover:bg-white/5 hover:text-slate-300"
                                : "text-slate-300 hover:bg-white/5 hover:text-white",
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span
                                aria-hidden
                                className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-400"
                              />
                            )}
                            <Icon aria-hidden className="size-4 shrink-0" />
                            <span className={clsx("truncate", collapsed && "lg:hidden")}>
                              {item.label}
                            </span>
                            {planned && (
                              <span
                                title="Not migrated yet"
                                className={clsx(
                                  "ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-inset ring-slate-700",
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

        <div className="border-t border-white/10 p-3">
          <div
            className={clsx(
              "flex items-center gap-2.5 rounded-lg px-2 py-2",
              collapsed && "lg:flex-col lg:gap-1 lg:px-0",
            )}
          >
            <div
              title={collapsed ? user?.userName : undefined}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white"
            >
              {initials}
            </div>
            <div className={clsx("min-w-0 flex-1 leading-tight", collapsed && "lg:hidden")}>
              <div className="truncate text-sm font-medium text-white">{user?.userName}</div>
              <div className="truncate text-[11px] text-slate-400">
                {user?.permissions.length ?? 0} permissions
              </div>
            </div>
            <button
              onClick={() => void logout()}
              aria-label="Sign out"
              title="Sign out"
              /*
               * Bigger on touch, unchanged with a mouse. Sign out sits next to
               * nothing else, so a 28px target was easy to miss and easy to hit
               * by accident on the way past.
               */
              className="shrink-0 rounded-md p-3 text-slate-400 transition-colors hover:bg-white/10 hover:text-white lg:p-1.5"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur lg:px-8">
          {/*
            `min-w-0` is what lets this side give way, and its absence was a real
            bug: a flex item defaults to `min-width: auto` and refuses to shrink
            below its own content, so the breadcrumb held the header open and the
            header pushed past the viewport. EVERY screen scrolled sideways on a
            phone as a result — 424px of header in a 390px window, measured — and
            the three that did not were simply the ones with short names.
          */}
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
              className="-ml-1 shrink-0 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 lg:hidden"
            >
              <Menu className="size-5" />
            </button>

            {/*
              THE COLLAPSE CONTROL SITS WHERE THE HAMBURGER SITS, one breakpoint
              apart, so the same corner works the navigation at every width.

              Putting it inside the rail was the other option and is the worse
              one: collapsed, the rail is 64px of destinations with no room for a
              control that is not one, and a toggle tucked under the sign-out
              button is somewhere nobody looks.
            */}
            <button
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              aria-expanded={!collapsed}
              aria-controls="app-sidebar"
              title={collapsed ? "Expand navigation" : "Collapse navigation"}
              className="-ml-1 hidden shrink-0 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 lg:inline-flex"
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden className="size-5" />
              ) : (
                <PanelLeftClose aria-hidden className="size-5" />
              )}
            </button>

            <Breadcrumb pathname={location.pathname} />
          </div>

          {/*
            This side does NOT give way. The scope picker says whose data is on
            screen, and a reader who cannot see it is reading numbers without
            knowing which site they belong to. The breadcrumb truncates instead —
            the page below repeats its own name as a heading.
          */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Temporary: here so the business can compare the two layouts on
                real data and answer the question in doc 19. It goes when they do. */}
            <RecordLayoutPicker />

            <SiteScopePicker />

            {/* The financial year yields the width on a phone; the site does not. */}
            <div className="hidden items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-inset ring-slate-200 sm:flex">
              <CalendarDays aria-hidden className="size-3.5 text-slate-400" />
              <span className="hidden text-xs text-slate-500 lg:inline">Financial year</span>
              <span className="tabular text-xs font-semibold text-slate-800">{fy}</span>
            </div>
          </div>
        </header>

        {/*
          Room for the docked record, and only while one is open.

          The pane is `position: fixed`, so without this it would sit ON TOP of
          the right-hand columns of the grid — which would look like the split
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
             * of the list — the layout looked right in a screenshot and defeated
             * its own purpose. Measured in a real browser, not reasoned about.
             */
            paneOpen ? "pr-4 sm:pr-[29rem]" : "pr-4 lg:pr-8",
          )}
        >
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Breadcrumb({ pathname }: { pathname: string }) {
  const section = NAV.find((group) => group.items.some((item) => item.to === pathname));
  const item = section?.items.find((entry) => entry.to === pathname);
  if (!item) {
    return null;
  }
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      {/*
        The section and its separator go on a phone. They are the least useful
        half — "Masters / Companies" says little more than "Companies" — and on a
        390px screen they are the difference between a header that fits and one
        that does not.
      */}
      <span className="hidden shrink-0 text-slate-400 sm:inline">{section?.title}</span>
      <span aria-hidden className="hidden shrink-0 text-slate-300 sm:inline">
        /
      </span>
      <span className="truncate font-medium text-slate-700">{item.label}</span>
    </nav>
  );
}
