import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { AuthenticatedUser } from "@accountmanagement/contracts";
import { AuthContext } from "../contexts/AuthContext";
import { StaticSiteScope, type SiteScope } from "../contexts/SiteScopeContext";
import { StaticRecordLayout, type RecordLayout } from "../contexts/RecordLayoutContext";

/**
 * Renders a screen with a signed-in user, so permission-gated UI can be tested.
 *
 * Screens hide their Add button and disable their controls from
 * `usePermission(...)`, which reads the auth context. Rendering inside the real
 * `AuthProvider` gives a null user, so every one of those controls is hidden and
 * the test silently asserts against a read-only page — which passes for the
 * wrong reason if you are checking something is absent, and fails confusingly if
 * you are checking it works.
 *
 * `retry: false` matters as much: TanStack Query's default retry turns a test's
 * deliberate 500 into three requests and a timeout instead of an error state.
 */
export function renderWithAuth(
  node: ReactNode,
  {
    permissions = [] as string[],
    scope,
    layout,
  }: {
    permissions?: string[];
    /**
     * How a record opens. Defaults to "modal" — what every screen shipped with,
     * and what a test that says nothing about layout should get.
     */
    layout?: RecordLayout;
    /**
     * The site scope the screen sees. Defaults to every site and READY, so a
     * test that has nothing to say about site scoping is not held on a loading
     * state it never resolves.
     */
    scope?: Partial<SiteScope>;
  } = {},
) {
  const user: AuthenticatedUser = { id: "test-user", userName: "tester", permissions };

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider
        value={{
          user,
          isAuthenticated: true,
          // A test renders a screen that is already signed in; the restore from
          // the refresh cookie is over before any of this matters.
          isRestoring: false,
          endedReason: null,
          login: vi.fn(),
          logout: vi.fn(),
        }}
      >
        <StaticSiteScope {...scope}>
          <StaticRecordLayout layout={layout}>
            {/*
              A router, because a screen containing a `<Link>` cannot render
              without one. react-router's failure is "Cannot destructure
              property 'basename' of useContext(...) as it is null", thrown from
              its own internals — it names neither the component nor the missing
              provider, so it costs real time to place. Inert for screens with no
              links, so it belongs here rather than in each test that needs it.
            */}
            <MemoryRouter>{node}</MemoryRouter>
          </StaticRecordLayout>
        </StaticSiteScope>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

/** A JSON response. Build a FRESH one per call — a body can only be read once. */
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const noContent = () => new Response(null, { status: 204 });

/**
 * Routes `fetch` by pathname, building a fresh Response each time.
 *
 * Screens that make more than one request — a list plus a lookup for a dropdown
 * — break under a single `mockResolvedValue`: it hands the same Response to
 * both, and the second read throws "body already read". The query then fails at
 * the schema and the grid shows a generic load error, which points nowhere near
 * the test's actual mistake.
 */
export function routeFetch(routes: Array<[RegExp, unknown]>, fallback?: unknown) {
  vi.mocked(globalThis.fetch).mockImplementation((input) => {
    const url = new URL(String(input), "http://localhost");
    const match = routes.find(([pattern]) => pattern.test(url.pathname));
    if (match) {
      return Promise.resolve(match[1] instanceof Response ? match[1] : json(match[1]));
    }
    if (fallback !== undefined) {
      return Promise.resolve(fallback instanceof Response ? fallback : json(fallback));
    }
    return Promise.resolve(json({ message: `No test route for ${url.pathname}` }, 404));
  });
}

/**
 * Choose an item in an `ItemCombobox`, the way a person does.
 *
 * The item dropdowns were native `<select>`s until 16 Sep 2026 and every test
 * drove them with `selectOptions(…, id)`. They are comboboxes now: there is no
 * `<option value="{uuid}">` to select, so a test picks BY NAME, which is what
 * the user sees and types.
 *
 * Opening it, letting the debounced search settle and clicking the option is
 * three steps that every one of those tests would otherwise repeat.
 */
/**
 * Either `userEvent` itself or an instance from `userEvent.setup()`.
 *
 * The two have different signatures — the bare export takes an options argument
 * the instance does not — and both are used across this suite. Naming only the
 * methods these helpers call accepts either.
 */
type UserLike = {
  click: (element: Element) => Promise<unknown>;
  type: (element: Element, text: string) => Promise<unknown>;
};

export async function pickItem(
  user: UserLike,
  field: RegExp,
  itemName: string | RegExp,
) {
  const box = screen.getByRole("combobox", { name: field });
  await user.click(box);

  // The list is filtered by a 200ms-debounced request, so the option arrives
  // after the click rather than with it.
  const option = await screen.findByRole("option", { name: itemName });
  await user.click(option);
}

/**
 * Type a name into an `ItemCombobox` and commit it as free text, taking the
 * "Use ‘…’ as a typed name" option at the bottom of the list.
 */
export async function typeItemName(
  user: UserLike,
  field: RegExp,
  name: string,
) {
  const box = screen.getByRole("combobox", { name: field });
  await user.click(box);
  await user.type(box, name);
  await user.click(await screen.findByRole("option", { name: /as a typed name/i }));
}
