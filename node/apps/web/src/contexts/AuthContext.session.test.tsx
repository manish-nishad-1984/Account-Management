import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AuthProvider, IDLE_LIMIT_MS, IDLE_WARNING_MS, __resetRestoreForTests, useAuth } from "./AuthContext";
import { ApiError, apiRequest } from "../lib/api-client";

/**
 * THE SESSION WHILE SOMEONE WORKS, AND WHILE NOBODY DOES (18 Sep 2026).
 *
 * The reported bug: signed out mid-task every 15 minutes, because the access
 * token was only ever renewed on a page load. And the rules the business chose
 * with the fix: 30 minutes idle signs out, with a minute's warning; working
 * never does.
 *
 * The clock is faked, so half an hour passes in a moment.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const USER = { id: "u1", userName: "tester", permissions: ["company.view"] };
const MINUTE = 60_000;

let refreshes = 0;
let logouts = 0;
let refreshFails: "no" | "network" | "rejected" = "no";

/**
 * The API as the browser meets it. `access-1` is the token handed out at sign-in
 * and is treated as already expired, so the first ordinary request meets a 401
 * exactly as it would 15 minutes into a session.
 */
function routeFetch() {
  vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("Authorization");
    if (url.endsWith("/auth/login")) return json({ accessToken: "access-1", user: USER });
    if (url.endsWith("/auth/refresh")) {
      if (refreshFails === "network") throw new TypeError("Failed to fetch");
      if (refreshFails === "rejected") return json({ message: "Invalid refresh token" }, 401);
      refreshes += 1;
      return json({ accessToken: `access-${refreshes + 1}`, user: USER });
    }
    if (url.endsWith("/auth/logout")) {
      logouts += 1;
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/companies")) {
      return auth === "Bearer access-1" ? json({ message: "Unauthorized" }, 401) : json({ ok: true });
    }
    return json({ message: "Not found" }, 404);
  });
}

const okSchema = z.object({ ok: z.boolean() });

function Probe() {
  const { user, endedReason, login } = useAuth();
  const [result, setResult] = useState("");
  const describe = (error: unknown) => (error instanceof ApiError ? `failed ${error.status}` : "failed");
  return (
    <>
      <p>{user ? `signed in as ${user.userName}` : `signed out${endedReason ? ` (${endedReason})` : ""}`}</p>
      <p>{result}</p>
      <button onClick={() => void login({ userName: "tester", password: "pw" })}>sign in</button>
      <button
        onClick={() =>
          apiRequest("/companies", { schema: okSchema }).then(
            () => setResult("loaded"),
            (error) => setResult(describe(error)),
          )
        }
      >
        load
      </button>
      <button
        onClick={() =>
          Promise.all(Array.from({ length: 5 }, () => apiRequest("/companies", { schema: okSchema }))).then(
            (rows) => setResult(`loaded ${rows.length}`),
            (error) => setResult(describe(error)),
          )
        }
      >
        load five
      </button>
    </>
  );
}

/** Let fetches, JSON parsing and state updates settle. */
async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function pass(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

async function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
  await settle();
}

async function signIn() {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await settle();
  await click("sign in");
  // The server would have set it with the login response; jsdom's fetch is mocked.
  document.cookie = "ab_session=1";
  expect(screen.getByText("signed in as tester")).toBeInTheDocument();
}

describe("the session while someone works, and while nobody does", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    __resetRestoreForTests();
    window.localStorage.clear();
    document.cookie = "ab_session=; Max-Age=0";
    refreshes = 0;
    logouts = 0;
    refreshFails = "no";
    vi.spyOn(globalThis, "fetch");
    routeFetch();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.cookie = "ab_session=; Max-Age=0";
  });

  describe("working", () => {
    /** The reported bug. */
    it("renews an expired token and repeats the request, and the person never knows", async () => {
      await signIn();
      await click("load");

      expect(screen.getByText("loaded")).toBeInTheDocument();
      expect(screen.getByText("signed in as tester")).toBeInTheDocument();
      expect(refreshes).toBe(1);
    });

    /**
     * Rotation spends the cookie on every use: a second refresh racing the first
     * would present a spent token, and the server would end the session.
     */
    it("renews once for five requests that all found the token expired", async () => {
      await signIn();
      await click("load five");

      expect(screen.getByText("loaded 5")).toBeInTheDocument();
      expect(refreshes).toBe(1);
    });

    it("keeps an active session renewed even when no request is made", async () => {
      await signIn();
      // Typing into a long form: a key every three minutes, no request at all.
      for (let i = 0; i < 8; i += 1) {
        await pass(3 * MINUTE);
        fireEvent.keyDown(document.body, { key: "a" });
      }

      expect(refreshes).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("signed in as tester")).toBeInTheDocument();
    });

    /** A dropped connection is not the end of a session. */
    it("does not sign anyone out when the server cannot be reached", async () => {
      await signIn();
      refreshFails = "network";
      await click("load");

      expect(screen.getByText("failed 401")).toBeInTheDocument();
      expect(screen.getByText("signed in as tester")).toBeInTheDocument();
    });

    it("signs out, saying why, when the server no longer honours the session", async () => {
      await signIn();
      refreshFails = "rejected";
      await click("load");

      expect(screen.getByText("signed out (expired)")).toBeInTheDocument();
    });
  });

  describe("idle", () => {
    it("warns a minute before the 30 minutes are up", async () => {
      await signIn();
      await pass(IDLE_LIMIT_MS - IDLE_WARNING_MS + 1_000);

      expect(screen.getByRole("dialog", { name: "Still working?" })).toBeInTheDocument();
      expect(screen.getByText("signed in as tester")).toBeInTheDocument();
    });

    it("signs out after 30 minutes with nothing done, on the server too", async () => {
      await signIn();
      await pass(IDLE_LIMIT_MS + 1_000);

      expect(screen.getByText("signed out (idle)")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Still working?" })).not.toBeInTheDocument();
      expect(logouts).toBe(1);
    });

    it("keeps the session for whoever answers the warning", async () => {
      await signIn();
      await pass(IDLE_LIMIT_MS - IDLE_WARNING_MS + 5_000);
      await click("Continue working");
      await pass(5 * MINUTE);

      expect(screen.getByText("signed in as tester")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Still working?" })).not.toBeInTheDocument();
    });

    it("counts any key or click as being there", async () => {
      await signIn();
      await pass(20 * MINUTE);
      fireEvent.pointerDown(document.body);
      await pass(20 * MINUTE);

      expect(screen.getByText("signed in as tester")).toBeInTheDocument();
    });

    /** Working in another tab is working. */
    it("counts activity in another tab", async () => {
      await signIn();
      await pass(20 * MINUTE);
      window.localStorage.setItem("ab_last_activity", String(Date.now()));
      await pass(20 * MINUTE);

      expect(screen.getByText("signed in as tester")).toBeInTheDocument();
    });

    /** An idle session is left to run out, not kept alive by the timer. */
    it("does not renew a session nobody is using", async () => {
      await signIn();
      await pass(25 * MINUTE);

      expect(refreshes).toBe(0);
    });

    it("signs out here when another tab signed out", async () => {
      await signIn();
      await act(async () => {
        window.dispatchEvent(new StorageEvent("storage", { key: "ab_signed_out", newValue: `idle:${Date.now()}` }));
      });

      expect(screen.getByText("signed out (idle)")).toBeInTheDocument();
    });
  });
});
