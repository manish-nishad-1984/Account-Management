import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, __resetRestoreForTests, useAuth } from "../contexts/AuthContext";
import { LoginPage } from "../features/auth/LoginPage";
import { RequireAuth } from "./RequireAuth";

/**
 * WHAT THE NEXT PERSON AT THE KEYBOARD MUST NOT INHERIT (21 Sep 2026).
 *
 * The client's worry: somebody leaves their PC, the session ends, somebody else
 * sits down and signs in — and finds the last person's page in front of them, and
 * the last person's data in it. Two things could do that, and both are pinned here:
 *
 *  - the sign-in returning to the page the session ended on;
 *  - the query cache, which is keyed by resource and NOT by user, still holding the
 *    last person's lists for five minutes after they went.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const USER = { id: "u1", userName: "manish", permissions: ["invoice.view"] };
const CACHE_KEY = ["purchase-orders", "list", "someone-elses-rows"];

let client: QueryClient;

function SignOutButton() {
  const { logout } = useAuth();
  return <button onClick={() => void logout()}>sign out now</button>;
}

function renderApp(initial: string) {
  client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <AuthProvider onSessionEnd={() => client.clear()}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<RequireAuth><div>front page</div><SignOutButton /></RequireAuth>} />
            <Route path="/orders" element={<RequireAuth><div>the order list</div><SignOutButton /></RequireAuth>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function signIn() {
  await userEvent.type(await screen.findByLabelText(/username/i), "manish");
  await userEvent.type(screen.getByLabelText(/password/i), "Admin123");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("when a session ends, the next person to sign in starts clean", () => {
  beforeEach(() => {
    __resetRestoreForTests();
    window.localStorage.clear();
    document.cookie = "ab_session=; Max-Age=0";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/auth/logout") ? new Response(null, { status: 204 }) : json({ accessToken: "t", user: USER }),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A bookmark is still a bookmark: somebody who was never signed in goes where they were headed. */
  it("still takes a first-time visitor to the page they asked for", async () => {
    renderApp("/orders");
    await signIn();

    expect(await screen.findByText("the order list")).toBeInTheDocument();
  });

  it("does not return to the page the last session ended on", async () => {
    renderApp("/orders");
    await signIn();
    expect(await screen.findByText("the order list")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "sign out now" }));
    // Signed out: the login page, and nothing of the order list on screen.
    await screen.findByRole("button", { name: /sign in/i });
    expect(screen.queryByText("the order list")).not.toBeInTheDocument();

    await signIn();

    expect(await screen.findByText("front page")).toBeInTheDocument();
    expect(screen.queryByText("the order list")).not.toBeInTheDocument();
  });

  it("empties the query cache the moment the session ends", async () => {
    renderApp("/orders");
    await signIn();
    await screen.findByText("the order list");
    client.setQueryData(CACHE_KEY, [{ supplier: "the last person's supplier" }]);

    await userEvent.click(screen.getByRole("button", { name: "sign out now" }));
    await screen.findByRole("button", { name: /sign in/i });

    expect(client.getQueryData(CACHE_KEY)).toBeUndefined();
  });

  /** Idle and expiry end through the same path, and so does another tab signing out. */
  it("empties it when another tab ends the session", async () => {
    renderApp("/orders");
    await signIn();
    await screen.findByText("the order list");
    client.setQueryData(CACHE_KEY, [{ supplier: "the last person's supplier" }]);

    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "ab_signed_out", newValue: `idle:${Date.now()}` }));
    });
    await screen.findByRole("button", { name: /sign in/i });

    expect(client.getQueryData(CACHE_KEY)).toBeUndefined();
  });

  /** A session can be gone without ever passing through the sign-out path. */
  it("empties it on the way IN too", async () => {
    renderApp("/orders");
    await screen.findByRole("button", { name: /sign in/i });
    client.setQueryData(CACHE_KEY, [{ supplier: "left behind" }]);

    await signIn();
    await screen.findByText("the order list");

    expect(client.getQueryData(CACHE_KEY)).toBeUndefined();
  });
});
