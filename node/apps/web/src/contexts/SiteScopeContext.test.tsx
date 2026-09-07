import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteScopeProvider, useSiteScope } from "./SiteScopeContext";
import { SiteScopePicker } from "../components/SiteScopePicker";
import { json } from "../test/render";

/**
 * The site scope, driven through the header control that sets it.
 *
 * Written against the picker rather than the hook alone because the two halves
 * fail together in the way that matters: a default the provider computes and the
 * control never shows is indistinguishable, from the user's side, from no
 * default at all — and that is precisely the source's bug, where
 * `<option ... isSelected>` drops the `@` and the computed selection is never
 * applied to the markup.
 */

const AKWADA = "11111111-1111-1111-1111-111111111111";
const RIVERFRONT = "22222222-2222-2222-2222-222222222222";
const USER = "user-1";

const SITES = [
  { id: AKWADA, name: "Akwada Lake Front" },
  { id: RIVERFRONT, name: "Riverfront Phase 2" },
];

const key = `accountbook.siteScope.${USER}`;

/** Reports what the rest of the application would filter by. */
function ScopeReadout() {
  const { siteId, siteName, isReady } = useSiteScope();
  return (
    <div>
      <span data-testid="site-id">{siteId ?? "(all)"}</span>
      <span data-testid="site-name">{siteName ?? "(none)"}</span>
      <span data-testid="ready">{String(isReady)}</span>
    </div>
  );
}

const renderScope = (userId: string | null = USER) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SiteScopeProvider userId={userId}>
        <SiteScopePicker />
        <ScopeReadout />
      </SiteScopeProvider>
    </QueryClientProvider>,
  );

const respond = (scope: "assigned" | "all", sites = SITES) =>
  vi
    .mocked(globalThis.fetch)
    .mockImplementation(() => Promise.resolve(json({ scope, sites })));

const settled = () => waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));

const scopedTo = () => screen.getByTestId("site-id").textContent;

describe("site scope", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("reads the caller's sites from an endpoint that needs no permission", async () => {
    respond("all");
    renderScope();
    await settled();

    const url = String(vi.mocked(globalThis.fetch).mock.calls[0]![0]);
    expect(url).toContain("/sites/assignable");
    // NOT /sites — that list is guarded by `site.view`, the right that governs
    // the Site master screen, which a request clerk has no reason to hold.
    expect(url).not.toMatch(/\/sites\?/);
  });

  describe("an unassigned user", () => {
    it("starts on every site", async () => {
      respond("all");
      renderScope();
      await settled();

      expect(scopedTo()).toBe("(all)");
      expect(screen.getByRole("option", { name: "All sites" })).toBeInTheDocument();
    });

    it("can narrow to one site and back to all of them", async () => {
      respond("all");
      renderScope();
      await settled();

      await userEvent.selectOptions(screen.getByLabelText("Site"), AKWADA);
      expect(scopedTo()).toBe(AKWADA);
      expect(screen.getByTestId("site-name")).toHaveTextContent("Akwada Lake Front");

      await userEvent.selectOptions(screen.getByLabelText("Site"), "all");
      expect(scopedTo()).toBe("(all)");
    });
  });

  /**
   * `UserSession.SiteData` holds the user's own sites and the layout offers no
   * "All Site" entry when it is non-empty, so an assigned user always works one
   * site. That rule is reproduced; it is presentation, not authorisation.
   */
  describe("an assigned user", () => {
    it("starts on their first site rather than on everything", async () => {
      respond("assigned");
      renderScope();
      await settled();

      expect(scopedTo()).toBe(AKWADA);
    });

    it("is offered no All sites entry", async () => {
      respond("assigned");
      renderScope();
      await settled();

      expect(screen.queryByRole("option", { name: "All sites" })).not.toBeInTheDocument();
      expect(screen.getAllByRole("option")).toHaveLength(2);
    });

    it("says so rather than showing an empty box when every assigned site is gone", async () => {
      respond("assigned", []);
      renderScope();
      await settled();

      expect(screen.getByRole("option", { name: /no sites assigned/i })).toBeInTheDocument();
    });
  });

  describe("remembering the choice", () => {
    it("survives a reload, which the source's sessionStorage does not", async () => {
      respond("all");
      const first = renderScope();
      await settled();
      await userEvent.selectOptions(screen.getByLabelText("Site"), RIVERFRONT);
      first.unmount();

      renderScope();
      await settled();
      expect(scopedTo()).toBe(RIVERFRONT);
    });

    it("keeps one user's choice away from another's", async () => {
      window.localStorage.setItem(key, RIVERFRONT);
      respond("assigned");

      // The same storage, the same response — only the user differs, so this
      // cannot pass by the preference being ignored altogether.
      const mine = renderScope(USER);
      await settled();
      expect(scopedTo()).toBe(RIVERFRONT);
      mine.unmount();

      renderScope("user-2");
      await settled();
      expect(scopedTo()).toBe(AKWADA);
    });

    /**
     * The important one. Somebody removed from a site would otherwise go on
     * filtering by it and see an empty application, with every screen agreeing —
     * which looks like the data is gone rather than the filter is wrong.
     */
    it("discards a stored site that is no longer on offer", async () => {
      window.localStorage.setItem(key, "99999999-9999-9999-9999-999999999999");
      respond("assigned");
      renderScope();
      await settled();

      expect(scopedTo()).toBe(AKWADA);
    });

    it("discards a stored All sites once the user becomes assigned to one", async () => {
      window.localStorage.setItem(key, "all");
      respond("assigned");
      renderScope();
      await settled();

      expect(scopedTo()).toBe(AKWADA);
    });

    it("renders normally when the browser refuses local storage outright", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("The operation is insecure");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("The operation is insecure");
      });
      respond("all");
      renderScope();
      await settled();

      await userEvent.selectOptions(screen.getByLabelText("Site"), AKWADA);
      expect(scopedTo()).toBe(AKWADA);
    });
  });

  describe("before it has resolved", () => {
    it("is not ready, and scopes to nothing", () => {
      vi.mocked(globalThis.fetch).mockImplementation(() => new Promise(() => {}));
      renderScope();

      expect(screen.getByTestId("ready")).toHaveTextContent("false");
      expect(screen.getByLabelText("Site")).toBeDisabled();
      expect(screen.getByRole("option", { name: /loading sites/i })).toBeInTheDocument();
    });
  });

  it("says the sites are unavailable rather than offering an empty control", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve(json({ message: "boom" }, 500)),
    );
    renderScope();

    expect(await screen.findByRole("alert")).toHaveTextContent(/sites unavailable/i);
  });

  it("asks for nothing at all when there is no signed-in user", () => {
    renderScope(null);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });
});
