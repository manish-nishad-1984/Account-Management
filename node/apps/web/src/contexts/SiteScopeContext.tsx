import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  siteScopeResponseSchema,
  type SiteScopeOption,
  type SiteScopeResponse,
} from "@accountmanagement/contracts";
import { apiRequest } from "../lib/api-client";

/**
 * Which site the whole application is looking at.
 *
 * Every legacy screen carries this in its header — `drpSiteName` in
 * `Main_Layout.cshtml` — and everything below it is filtered by the choice. It
 * belongs in the shell for the same reason it does there: the people using this
 * work one site at a time, and a per-screen site filter means re-choosing on
 * every screen, every time.
 *
 * Four defects in the source version are NOT reproduced:
 *
 *  1. `<option value="@site.SiteId" isSelected>` renders the literal attribute
 *     `isSelected` on every option — the `@` is missing — so the computed
 *     selection is never applied and the markup always leaves the FIRST site
 *     selected regardless of what the server session holds. The header and the
 *     server can therefore disagree about which site is in scope.
 *  2. Changing site calls `/Home/PurchaseRequestList` for its session side
 *     effect, writes the returned dashboard partial into `#tbPndingApproval`,
 *     and then `location.reload()`s — discarding the HTML it just fetched and
 *     reloading the page it just updated.
 *  3. The choice is kept in `sessionStorage`, so it dies with the browser tab.
 *  4. For an unassigned user the dropdown is populated asynchronously with no
 *     placeholder, so the header is briefly an empty box on a slow load.
 *
 * What IS reproduced is the two-case rule from `siteScopeResponseSchema`: a user
 * with rows in `user_sites` chooses among those and has no "All sites"; a user
 * with none sees every site and defaults to all of them. That is presentation
 * only — narrowing a dropdown is not authorisation, and it was not one in the
 * source either. See the note on the contract.
 */

export interface SiteScope {
  /** The site to filter by, or null for every site. */
  siteId: string | null;
  /** The chosen site's name, for display. Null when the scope is every site. */
  siteName: string | null;
  setSiteId: (siteId: string | null) => void;
  sites: SiteScopeOption[];
  /** Whether "All sites" is on offer — true only for an unassigned user. */
  canSelectAll: boolean;
  /**
   * False until the options have loaded and `siteId` means something.
   *
   * Scoped lists must not fetch before this: an assigned user's default is their
   * first site, not "everything", so querying early shows every site's rows for
   * a moment and then replaces them. That reads as a data bug rather than a
   * loading state.
   */
  isReady: boolean;
  error: unknown;
}

const SiteScopeContext = createContext<SiteScope | null>(null);

/** `localStorage` key. Per user, because two people share a machine at a site office. */
const storageKey = (userId: string) => `accountbook.siteScope.${userId}`;

/** The stored value for "every site" — distinct from "nothing stored yet". */
const ALL = "all";

/**
 * localStorage throws outright in some privacy modes rather than returning null,
 * and a site preference is not worth failing a render over.
 *
 * Persisting this at all is a departure from `AuthContext`, which deliberately
 * keeps everything in memory. The distinction is what the value IS: a site id is
 * a display preference, readable by anyone at the keyboard and useful to nobody
 * else. A token is a credential.
 */
const readStored = (userId: string): string | null => {
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
};

const writeStored = (userId: string, value: string) => {
  try {
    window.localStorage.setItem(storageKey(userId), value);
  } catch {
    /* A preference that cannot be remembered is not an error worth showing. */
  }
};

/**
 * Mount with `key={userId}`, so signing in as somebody else discards the
 * previous person's choice rather than carrying it into an account that may not
 * even be assigned to that site.
 */
export function SiteScopeProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: ReactNode;
}) {
  const query = useQuery({
    queryKey: ["sites", "assignable"],
    enabled: userId !== null,
    // The set of sites a user may pick from changes when an administrator edits
    // their assignment, which is rare. Refetching it per screen is pure noise.
    staleTime: 5 * 60 * 1000,
    queryFn: ({ signal }) =>
      apiRequest<SiteScopeResponse>("/sites/assignable", {
        schema: siteScopeResponseSchema,
        signal,
      }),
  });

  const [chosen, setChosen] = useState<string | null>(() =>
    userId ? readStored(userId) : null,
  );

  const value = useMemo<SiteScope>(() => {
    const data = query.data;
    const sites = data?.sites ?? [];
    const canSelectAll = data?.scope === "all";

    /**
     * A stored id that is no longer on offer is DISCARDED, not sent to the API.
     *
     * Somebody removed from a site otherwise keeps filtering by it and sees an
     * empty application with nothing on screen to say why — and every list they
     * open agrees with each other, which makes it look like the data is gone
     * rather than the filter is wrong.
     */
    const storedIsValid =
      chosen !== null && (chosen === ALL ? canSelectAll : sites.some((s) => s.id === chosen));

    const siteId = !data
      ? null
      : storedIsValid
        ? chosen === ALL
          ? null
          : chosen
        : // The default: everything for an unassigned user, and the first
          // assigned site otherwise — an assigned user is never unscoped.
          canSelectAll
          ? null
          : (sites[0]?.id ?? null);

    return {
      siteId,
      siteName: sites.find((s) => s.id === siteId)?.name ?? null,
      setSiteId: (next) => {
        if (userId) writeStored(userId, next ?? ALL);
        setChosen(next ?? ALL);
      },
      sites,
      canSelectAll,
      isReady: query.isSuccess,
      error: query.error,
    };
  }, [query.data, query.isSuccess, query.error, chosen, userId]);

  return <SiteScopeContext.Provider value={value}>{children}</SiteScopeContext.Provider>;
}

export function useSiteScope(): SiteScope {
  const context = useContext(SiteScopeContext);
  if (!context) {
    throw new Error("useSiteScope must be used inside <SiteScopeProvider>");
  }
  return context;
}

/**
 * The site filter a scoped list should send, and whether it may fetch yet.
 *
 * Every site-scoped list hook reads this rather than taking a site from its
 * screen: `usePurchaseRequestList` is the worked example, and each module that
 * lands copies the same three lines. An explicit `siteId` still wins, so a
 * screen that genuinely needs to ignore the scope — a cross-site report — can.
 */
export function useScopedSiteId(explicit?: string): { siteId: string | undefined; isReady: boolean } {
  const scope = useSiteScope();
  if (explicit !== undefined) {
    return { siteId: explicit || undefined, isReady: true };
  }
  return { siteId: scope.siteId ?? undefined, isReady: scope.isReady };
}

/**
 * A provider for tests and for screens rendered outside the shell.
 *
 * Without it every scoped screen has to be wrapped by hand in a test that has
 * nothing to say about site scoping, and forgetting throws from `useSiteScope`
 * with an error about a provider rather than about the assertion that failed.
 */
export function StaticSiteScope({
  children,
  ...overrides
}: Partial<SiteScope> & { children: ReactNode }) {
  const value: SiteScope = {
    siteId: null,
    siteName: null,
    setSiteId: () => {},
    sites: [],
    canSelectAll: true,
    isReady: true,
    error: null,
    ...overrides,
  };
  return <SiteScopeContext.Provider value={value}>{children}</SiteScopeContext.Provider>;
}

export { SiteScopeContext };
