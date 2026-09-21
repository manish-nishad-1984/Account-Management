import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  loginResponseSchema,
  type AuthenticatedUser,
  type LoginRequest,
  type LoginResponse,
} from "@accountmanagement/contracts";
import { ApiError, apiRequest, setAccessTokenProvider, setSessionRenewer } from "../lib/api-client";
import { IdleWarningDialog } from "../components/IdleWarningDialog";
import { z } from "zod";

/** Why the last session ended without the person pressing Sign out. */
export type SessionEnd = "idle" | "expired";

interface AuthState {
  user: AuthenticatedUser | null;
  isAuthenticated: boolean;
  /**
   * True until the one-off attempt to restore a session from the refresh cookie
   * has finished. Guards against showing the login page to someone who IS signed
   * in, for the fraction of a second before the answer comes back.
   */
  isRestoring: boolean;
  /**
   * Set when a session ended on its own — idle too long, or no longer honoured —
   * so the login page can say why instead of simply appearing. Cleared by
   * signing in, and never set by Sign out.
   */
  endedReason: SessionEnd | null;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * Exported so a test can supply a signed-in user directly.
 *
 * The provider deliberately has no way to seed one — the token lives in a ref
 * and only `login` sets it — which is right for production and leaves screens
 * whose UI depends on `usePermission` untestable. Supplying the context value is
 * better than a test-only prop on the provider, and better than mocking
 * `lib/permissions`, which would stub the very thing some of those tests assert.
 */
export const AuthContext = createContext<AuthState | null>(null);

// ---------------------------------------------------------------------------
// The session rules (business decision, 18 Sep 2026)
// ---------------------------------------------------------------------------
//
//  - Working: never signed out. The access token lives 15 minutes and is renewed
//    underneath the person — on a 401 (`api-client.ts`) and, while they are
//    active, every RENEW_EVERY_MS before it can expire.
//  - Idle 30 minutes with the app open: warned a minute before, then signed out,
//    on the server too.
//  - Browser closed: signed out. The refresh cookie is a session cookie, and the
//    server stops honouring a token unused for 45 minutes (`env.ts`), which is
//    what holds when a browser restores its session cookies on reopening.

/** Signed out after this long with no mouse, keyboard or touch in any tab. */
export const IDLE_LIMIT_MS = 30 * 60_000;
/** The warning shows for this long before the sign-out. */
export const IDLE_WARNING_MS = 60_000;
/**
 * While someone is active, the session is renewed this often, whether or not
 * they make a request. Someone typing a long form for half an hour makes no
 * request at all, and the server's 45-minute window must not run out under them.
 */
export const RENEW_EVERY_MS = 10 * 60_000;
const TICK_MS = 1_000;

/** Shared by every tab, so working in one keeps the others signed in. Not a secret. */
const ACTIVITY_KEY = "ab_last_activity";
/** Written when a session ends, so every other tab ends with it. */
const SIGNED_OUT_KEY = "ab_signed_out";

let lastActivityHere = Date.now();
let lastActivityWritten = 0;

function markActivity(now = Date.now()): void {
  lastActivityHere = now;
  // Mouse movement fires constantly; the shared copy only needs to be close.
  if (now - lastActivityWritten < 5_000) return;
  lastActivityWritten = now;
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(now));
  } catch {
    // Storage blocked: this tab still counts its own activity.
  }
}

function lastActivity(): number {
  let shared = 0;
  try {
    shared = Number(window.localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    // As above.
  }
  return Math.max(lastActivityHere, shared);
}

function announceSignedOut(reason: SessionEnd | "signed-out"): void {
  try {
    window.localStorage.setItem(SIGNED_OUT_KEY, `${reason}:${Date.now()}`);
  } catch {
    // Other tabs then find out on their next request instead.
  }
}

// ---------------------------------------------------------------------------
// Renewing
// ---------------------------------------------------------------------------

/**
 * SINGLE-FLIGHT, and this is not optional.
 *
 * `/auth/refresh` ROTATES: the presented token is spent the moment it is
 * accepted. React StrictMode mounts every effect twice in development, so a
 * plain `useEffect` fires two refreshes — the first spends the cookie, the
 * second presents the same now-revoked value, gets a 401, and the server clears
 * the cookie. The result is being signed out on every reload, which is the exact
 * bug this whole change exists to remove.
 *
 * The same holds for the renewals a 401 now triggers: five queries failing at
 * once must renew once, not five times.
 *
 * The promise is module-level rather than a ref because StrictMode's second
 * mount is a NEW component instance: a ref would be freshly null and would not
 * dedupe anything.
 */
let refreshInFlight: Promise<LoginResponse | null> | null = null;

/**
 * The non-secret companion cookie the API sets beside the real one.
 *
 * The refresh cookie is HttpOnly, so this code cannot see it and cannot tell a
 * returning user from a first-time visitor. Without this hint the app would POST
 * `/auth/refresh` on every page load — including every visit to the login page
 * by someone with no session — and take a 401 for it each time.
 *
 * It is only a hint: the server still decides, and being wrong costs one request.
 */
function hasSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c.startsWith("ab_session="));
}

/**
 * ACROSS TABS TOO. Two tabs share one cookie, and two refreshes racing with it
 * sign BOTH out: the loser presents the token the winner just spent, and the
 * server answers 401 and clears the cookie. A browser-wide lock makes the second
 * wait and then present the cookie the first one left.
 */
function withRefreshLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return locks ? (locks.request("ab-auth-refresh", work) as Promise<T>) : work();
}

/**
 * The refresh cookie traded for a new session. Null when the server says there
 * is none; THROWS when the server could not be asked — a dropped connection is
 * not the end of a session, and must not sign anybody out.
 */
function refreshSession(): Promise<LoginResponse | null> {
  if (!hasSessionHint()) return Promise.resolve(null);
  refreshInFlight ??= withRefreshLock(() =>
    apiRequest("/auth/refresh", {
      method: "POST",
      // No body: the browser presents the HttpOnly cookie.
      body: {},
      schema: loginResponseSchema,
    }),
  )
    .catch((error: unknown) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
      throw error;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/** Test-only: drops a cached in-flight refresh and the activity clock between cases. */
export function __resetRestoreForTests(): void {
  refreshInFlight = null;
  lastActivityHere = Date.now();
  lastActivityWritten = 0;
}

const sameUser = (a: AuthenticatedUser | null, b: AuthenticatedUser) =>
  a !== null && JSON.stringify(a) === JSON.stringify(b);

/**
 * Holds the access token IN MEMORY only; the refresh token is never held here
 * at all.
 *
 * The .NET app wrote the user's cleartext password to a non-HttpOnly,
 * non-Secure cookie for 7 days when "Remember me" was ticked. The refresh token
 * now lives in an HttpOnly, SameSite cookie the API sets, scoped to the auth
 * routes — so script on the page cannot read it, and a page reload no longer
 * loses the session: the cookie survives and `refreshSession` trades it for a
 * fresh access token on load.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [endedReason, setEndedReason] = useState<SessionEnd | null>(null);
  const [warningSeconds, setWarningSeconds] = useState<number | null>(null);
  const accessToken = useRef<string | null>(null);
  const lastRenewal = useRef(0);

  const accept = useCallback((result: LoginResponse) => {
    accessToken.current = result.accessToken;
    lastRenewal.current = Date.now();
    // A renewal every ten minutes must not re-render the whole application when
    // nothing changed. When permissions DID change, the new ones apply here.
    setUser((previous) => (sameUser(previous, result.user) ? previous : result.user));
  }, []);

  /** Drop this tab's session. The server is told separately, where it needs to be. */
  const endHere = useCallback((reason: SessionEnd | null) => {
    accessToken.current = null;
    setUser(null);
    setWarningSeconds(null);
    setEndedReason(reason);
  }, []);

  const revokeOnServer = useCallback(async () => {
    // No body: the server reads the cookie and clears it. Sent even if it fails,
    // because the local session is already gone either way.
    await apiRequest("/auth/logout", {
      method: "POST",
      body: {},
      schema: z.undefined(),
    }).catch(() => undefined);
  }, []);

  /** A new access token, or null — ending the session only when the server says it is over. */
  const renew = useCallback(async (): Promise<string | null> => {
    let result: LoginResponse | null;
    try {
      result = await refreshSession();
    } catch {
      // Could not reach the server. The session may well be fine; the request
      // that asked fails with its own error and can be tried again.
      return null;
    }
    if (!result) {
      if (accessToken.current !== null) {
        endHere("expired");
        announceSignedOut("expired");
      }
      return null;
    }
    accept(result);
    return result.accessToken;
  }, [accept, endHere]);

  useEffect(() => {
    setAccessTokenProvider(() => accessToken.current);
    setSessionRenewer(renew);
    return () => setSessionRenewer(null);
  }, [renew]);

  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .catch(() => null)
      .then((result) => {
        if (cancelled) return;
        if (result) {
          // Opening the app is activity; an old shared timestamp from before must
          // not sign someone out the moment they arrive.
          markActivity();
          accept(result);
        }
        setIsRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accept]);

  const login = useCallback(
    async (credentials: LoginRequest) => {
      const result = await apiRequest("/auth/login", {
        method: "POST",
        body: credentials,
        schema: loginResponseSchema,
      });
      lastActivityWritten = 0;
      markActivity();
      setEndedReason(null);
      accept(result);
    },
    [accept],
  );

  const logout = useCallback(async () => {
    endHere(null);
    announceSignedOut("signed-out");
    await revokeOnServer();
  }, [endHere, revokeOnServer]);

  const signedIn = user !== null;

  /** Activity, the idle warning, the idle sign-out, and keeping a working session renewed. */
  useEffect(() => {
    if (!signedIn) return;
    lastActivityWritten = 0;
    markActivity();

    const onActivity = () => markActivity();
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const event of events) window.addEventListener(event, onActivity, { passive: true, capture: true });

    const tick = () => {
      const now = Date.now();
      const idle = now - lastActivity();
      if (idle >= IDLE_LIMIT_MS) {
        // Stopped first: another tick can land before React unmounts this
        // effect, and would sign out — and call the server — a second time.
        window.clearInterval(timer);
        endHere("idle");
        announceSignedOut("idle");
        void revokeOnServer();
        return;
      }
      if (idle >= IDLE_LIMIT_MS - IDLE_WARNING_MS) {
        setWarningSeconds(Math.ceil((IDLE_LIMIT_MS - idle) / 1000));
        return;
      }
      setWarningSeconds(null);
      // Only while they are actually working — an idle session is left to run
      // out, not kept alive by the timer.
      if (idle < RENEW_EVERY_MS && now - lastRenewal.current >= RENEW_EVERY_MS) {
        lastRenewal.current = now; // one attempt per interval, even if it fails
        void renew();
      }
    };
    const timer = window.setInterval(tick, TICK_MS);

    /** Another tab ended the session: end it here as well. */
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SIGNED_OUT_KEY || !event.newValue) return;
      const reason = event.newValue.split(":")[0];
      endHere(reason === "idle" || reason === "expired" ? reason : null);
    };
    window.addEventListener("storage", onStorage);

    return () => {
      for (const event of events) window.removeEventListener(event, onActivity, { capture: true });
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [signedIn, endHere, renew, revokeOnServer]);

  const stayActive = useCallback(() => {
    lastActivityWritten = 0;
    markActivity();
    setWarningSeconds(null);
    void renew();
  }, [renew]);

  const value = useMemo<AuthState>(
    () => ({ user, isAuthenticated: user !== null, isRestoring, endedReason, login, logout }),
    [user, isRestoring, endedReason, login, logout],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <IdleWarningDialog secondsLeft={warningSeconds} onContinue={stayActive} onSignOut={() => void logout()} />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return context;
}

/**
 * The same state, or null where there is no provider — for the things that
 * merely PREFER to know who is signed in.
 *
 * `useAuth` throws, and should: a screen that reads `user.permissions` to decide
 * what to render is broken without a provider, and failing loudly beats drawing
 * the wrong buttons. A stored preference is the opposite case. `useGridPageSize`
 * only wants a user id to key local storage by, and "anonymous" is a perfectly
 * good answer — so a grid rendered in a test with no auth around it should show
 * 20 rows, not bring down the tree.
 */
export function useOptionalAuth(): AuthState | null {
  return useContext(AuthContext) ?? null;
}
