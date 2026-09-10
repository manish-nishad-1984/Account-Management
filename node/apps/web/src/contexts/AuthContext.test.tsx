import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, __resetRestoreForTests, useAuth } from "./AuthContext";
import { RequireAuth } from "../components/RequireAuth";

/**
 * RELOADING THE PAGE MUST NOT SIGN YOU OUT.
 *
 * The reported symptom was that every refresh of the live site landed on the
 * login screen. The access token lives in memory and a reload throws it away —
 * that part is deliberate — so what has to work is trading the refresh cookie
 * for a new one before anything decides the reader is anonymous.
 *
 * Mounting the provider IS the reload: a fresh page load is a fresh mount.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const LOGIN_RESULT = {
  accessToken: "access-1",
  user: { id: "u1", userName: "tester", permissions: ["company.view"] },
};

/** jsdom has a real cookie jar, so the hint can simply be written. */
function giveSessionHint() {
  document.cookie = "ab_session=1";
}
function clearCookies() {
  for (const c of document.cookie.split("; ")) {
    const name = c.split("=")[0];
    if (name) document.cookie = `${name}=; Max-Age=0`;
  }
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/companies"]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<p>Sign in</p>} />
            <Route
              path="/companies"
              element={
                <RequireAuth>
                  <p>Companies</p>
                </RequireAuth>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("restoring a session on page load", () => {
  beforeEach(() => {
    __resetRestoreForTests();
    clearCookies();
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearCookies();
  });

  it("keeps the reader on the page they reloaded", async () => {
    giveSessionHint();
    vi.mocked(globalThis.fetch).mockResolvedValue(json(LOGIN_RESULT));

    renderApp();

    expect(await screen.findByText("Companies")).toBeInTheDocument();
    expect(screen.queryByText("Sign in")).not.toBeInTheDocument();
  });

  /**
   * The failure this guards is not a flicker. `RequireAuth` redirects with
   * `replace`, so a redirect taken before the answer arrives rewrites the URL
   * and the reader loses the page even if the session then restores.
   */
  it("does not show the login page while the answer is still coming", async () => {
    giveSessionHint();
    let release: ((r: Response) => void) | undefined;
    vi.mocked(globalThis.fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );

    renderApp();

    expect(screen.queryByText("Sign in")).not.toBeInTheDocument();
    expect(screen.queryByText("Companies")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();

    release?.(json(LOGIN_RESULT));
    expect(await screen.findByText("Companies")).toBeInTheDocument();
  });

  it("sends the reader to the login page when the cookie is no longer good", async () => {
    giveSessionHint();
    vi.mocked(globalThis.fetch).mockResolvedValue(json({ message: "Invalid" }, 401));

    renderApp();

    expect(await screen.findByText("Sign in")).toBeInTheDocument();
  });

  /**
   * No hint means nobody has signed in on this browser, so there is nothing to
   * ask the server about and the login page should render immediately.
   */
  it("asks the server nothing when there is no session hint", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(json(LOGIN_RESULT));

    renderApp();

    expect(await screen.findByText("Sign in")).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  /**
   * `/auth/refresh` SPENDS the token it is given. React StrictMode mounts effects
   * twice, so a second call would present an already-revoked value, be refused,
   * and clear the cookie — reproducing the very bug this fixes.
   */
  it("refreshes once even when the effect runs twice", async () => {
    giveSessionHint();
    vi.mocked(globalThis.fetch).mockResolvedValue(json(LOGIN_RESULT));

    const { unmount } = renderApp();
    unmount();
    renderApp();

    await waitFor(() => expect(screen.getByText("Companies")).toBeInTheDocument());
    const refreshCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([url]) => String(url).includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });
});

describe("signing out", () => {
  beforeEach(() => {
    __resetRestoreForTests();
    clearCookies();
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearCookies();
  });

  /** The browser holds the token now, so the app has none to send. */
  it("sends no refresh token in the body, because it does not have one", async () => {
    let auth: ReturnType<typeof useAuth> | undefined;
    function Probe() {
      auth = useAuth();
      return null;
    }
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 204 }));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(auth).toBeDefined());
    await auth!.logout();

    const [, init] = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url]) => String(url).includes("/auth/logout"))!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({});
  });
});
