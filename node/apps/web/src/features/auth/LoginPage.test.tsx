import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../contexts/AuthContext";
import { RequireAuth } from "../../components/RequireAuth";
import { LoginPage } from "./LoginPage";

const LOGIN_RESPONSE = {
  accessToken: "header.payload.signature",
  refreshToken: "opaque-refresh-token",
  user: { id: "user-1", userName: "manish", permissions: ["invoice.view"] },
};

function renderApp(initial = "/protected") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/protected"
              element={
                <RequireAuth>
                  <div>secret dashboard</div>
                </RequireAuth>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
  );
}

describe("login", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects an unauthenticated visitor to the login page", async () => {
    renderApp();
    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByText("secret dashboard")).not.toBeInTheDocument();
  });

  it("validates with the SHARED contract schema before calling the server", async () => {
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Username is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("signs in and lands on the page the visitor originally wanted", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify(LOGIN_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    renderApp();
    await userEvent.type(await screen.findByLabelText(/username/i), "manish");
    await userEvent.type(screen.getByLabelText(/password/i), "Admin123");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("secret dashboard")).toBeInTheDocument();
  });

  it("sends the credentials to the API as JSON", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify(LOGIN_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    renderApp();
    await userEvent.type(await screen.findByLabelText(/username/i), "manish");
    await userEvent.type(screen.getByLabelText(/password/i), "Admin123");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(url).toBe("/api/v1/auth/login");
    expect(JSON.parse(init!.body as string)).toEqual({
      userName: "manish",
      password: "Admin123",
    });
  });

  it("shows the server's message on a rejected login", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ message: "Invalid username or password" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    renderApp();
    await userEvent.type(await screen.findByLabelText(/username/i), "manish");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid username or password",
    );
    expect(screen.queryByText("secret dashboard")).not.toBeInTheDocument();
  });

  it("never writes the token to localStorage or sessionStorage", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify(LOGIN_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    renderApp();
    await userEvent.type(await screen.findByLabelText(/username/i), "manish");
    await userEvent.type(screen.getByLabelText(/password/i), "Admin123");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await screen.findByText("secret dashboard");

    const dump = JSON.stringify({ ...localStorage, ...sessionStorage });
    expect(dump).not.toContain("header.payload.signature");
    expect(dump).not.toContain("opaque-refresh-token");
    expect(dump).not.toContain("Admin123");
  });
});
