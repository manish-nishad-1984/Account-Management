import { Building2 } from "lucide-react";
import { useSiteScope } from "../contexts/SiteScopeContext";

/** The stored value standing for "every site" — mirrors `ALL` in the context. */
const ALL = "all";

/**
 * The site the application is scoped to, in the shell header.
 *
 * A bare `<select>` rather than `SelectField`: that control owns a block label
 * above the input, which is right in a form and wrong in a 64px header. The
 * label here is visually hidden instead, so the control still has an accessible
 * name and can be found by one.
 *
 * Rendered on every screen, including screens nothing scopes — Items and
 * Companies have no site. That matches the source, where the header dropdown is
 * always present, and the alternative is a control that appears and disappears
 * as you navigate, which is worse. The title says which screens it reaches.
 */
export function SiteScopePicker() {
  const { siteId, sites, canSelectAll, setSiteId, isReady, error } = useSiteScope();

  if (error) {
    return (
      <span className="text-xs font-medium text-rose-600" role="alert">
        Sites unavailable
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-inset ring-slate-200">
      <Building2 aria-hidden className="size-3.5 shrink-0 text-slate-400" />
      <label htmlFor="site-scope" className="sr-only">
        Site
      </label>
      <select
        id="site-scope"
        // A site id is a UUID; without this the closed control is 36 characters
        // wide on Chrome and the header wraps.
        className="max-w-[13rem] truncate border-0 bg-transparent py-0 pl-0 pr-6 text-xs font-semibold text-slate-800 focus:ring-0"
        title="The site every site-scoped screen is filtered to"
        disabled={!isReady}
        value={siteId ?? ALL}
        onChange={(event) =>
          setSiteId(event.target.value === ALL ? null : event.target.value)
        }
      >
        {!isReady && <option value={ALL}>Loading sites…</option>}
        {isReady && canSelectAll && <option value={ALL}>All sites</option>}
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
        {/*
          An assigned user with no sites left cannot pick anything, and an empty
          select is indistinguishable from one that failed to load. This says so.
        */}
        {isReady && !canSelectAll && sites.length === 0 && (
          <option value={ALL}>No sites assigned</option>
        )}
      </select>
    </div>
  );
}
