import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import clsx from "clsx";
import { CalendarDays, LogOut, Menu, X } from "lucide-react";
import { financialYear } from "@accountmanagement/domain";
import { useAuth } from "../contexts/AuthContext";
import { NAV } from "../navigation/nav";
import { SiteScopePicker } from "./SiteScopePicker";
import { RecordLayoutPicker } from "./RecordLayoutPicker";
import { useRecordLayout } from "../contexts/RecordLayoutContext";

/**
 * Account Book panel shell: a fixed module rail, a slim top bar, and the routed
 * page on a soft surface.
 *
 * Screens not yet migrated stay visible but dimmed and marked, so the panel
 * doubles as a readable record of migration progress rather than hiding work.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { paneOpen } = useRecordLayout();

  const initials = (user?.userName ?? "?").slice(0, 2).toUpperCase();
  const fy = financialYear.format(financialYear.currentAsProduced(new Date()));

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
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col",
          "bg-shell-900 transition-transform duration-200 ease-out",
          "lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-lg">
            AB
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold text-white">Account Book</div>
            <div className="truncate text-[11px] text-slate-400">D H Infra</div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
            className="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="scroll-subtle flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
          {NAV.map((section) => (
            <div key={section.title} className="mb-6 last:mb-2">
              <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
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
                        className={({ isActive }) =>
                          clsx(
                            "group relative flex items-center gap-2.5 rounded-lg px-3 py-2",
                            "text-sm transition-colors duration-150",
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
                            <span className="truncate">{item.label}</span>
                            {planned && (
                              <span
                                title="Not migrated yet"
                                className="ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-inset ring-slate-700"
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
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium text-white">{user?.userName}</div>
              <div className="truncate text-[11px] text-slate-400">
                {user?.permissions.length ?? 0} permissions
              </div>
            </div>
            <button
              onClick={() => void logout()}
              aria-label="Sign out"
              title="Sign out"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
              className="-ml-1 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 lg:hidden"
            >
              <Menu className="size-5" />
            </button>
            <Breadcrumb pathname={location.pathname} />
          </div>

          <div className="flex items-center gap-2">
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
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <span className="text-slate-400">{section?.title}</span>
      <span aria-hidden className="text-slate-300">
        /
      </span>
      <span className="font-medium text-slate-700">{item.label}</span>
    </nav>
  );
}
