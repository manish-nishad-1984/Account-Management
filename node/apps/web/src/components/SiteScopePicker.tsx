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

  /*
   * The vertical padding lives on the SELECT, not on this wrapper.
   *
   * With `py-1.5` out here the pill looked like a 32px control while the select
   * inside it was 17px tall: padding on an ancestor is not part of the target, so
   * tapping the visible edge of the pill did nothing at all.
   */
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 ring-1 ring-inset ring-slate-200">
      <Building2 aria-hidden className="size-3.5 shrink-0 text-slate-400" />
      <label htmlFor="site-scope" className="sr-only">
        Site
      </label>
      <select
        id="site-scope"
        /*
         * A site id is a UUID; without a cap the closed control is 36 characters
         * wide on Chrome and the header wraps.
         *
         * The cap is TIGHTER ON A PHONE. At 13rem this control alone was 208px
         * of a 390px screen and the header could not fit whatever else was in
         * it. Truncated site names are readable enough here because the full
         * list is one tap away, and the option list is not truncated.
         */
        className="max-w-[7.5rem] truncate border-0 bg-transparent py-2 pl-0 pr-6 text-xs font-semibold text-slate-800 focus:ring-0 sm:max-w-[13rem]"
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
