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
import { apiRequest, setAccessTokenProvider } from "../lib/api-client";
import { z } from "zod";

interface AuthState {
  user: AuthenticatedUser | null;
  isAuthenticated: boolean;
  /**
   * True until the one-off attempt to restore a session from the refresh cookie
   * has finished. Guards against showing the login page to someone who IS signed
   * in, for the fraction of a second before the answer comes back.
   */
  isRestoring: boolean;
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
 * The promise is module-level rather than a ref because StrictMode's second
 * mount is a NEW component instance: a ref would be freshly null and would not
 * dedupe anything.
 */
let restoreInFlight: Promise<LoginResponse | null> | null = null;

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

function restoreSession(): Promise<LoginResponse | null> {
  if (!hasSessionHint()) return Promise.resolve(null);
  restoreInFlight ??= apiRequest("/auth/refresh", {
    method: "POST",
    // No body: the browser presents the HttpOnly cookie. A 401 here is the
    // ordinary answer for someone who is simply not signed in.
    body: {},
    schema: loginResponseSchema,
  })
    .catch(() => null)
    .finally(() => {
      restoreInFlight = null;
    });
  return restoreInFlight;
}

/** Test-only: drops a cached in-flight restore between cases. */
export function __resetRestoreForTests(): void {
  restoreInFlight = null;
}

/**
 * Holds the access token IN MEMORY only; the refresh token is never held here
 * at all.
 *
 * The .NET app wrote the user's cleartext password to a non-HttpOnly,
 * non-Secure cookie for 7 days when "Remember me" was ticked. The refresh token
 * now lives in an HttpOnly, SameSite cookie the API sets, scoped to the auth
 * routes — so script on the page cannot read it, and a page reload no longer
 * loses the session: the cookie survives and `restoreSession` trades it for a
 * fresh access token on load.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const accessToken = useRef<string | null>(null);

  useEffect(() => {
    setAccessTokenProvider(() => accessToken.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void restoreSession().then((result) => {
      if (cancelled) return;
      if (result) {
        accessToken.current = result.accessToken;
        setUser(result.user);
      }
      setIsRestoring(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials: LoginRequest) => {
    const result = await apiRequest("/auth/login", {
      method: "POST",
      body: credentials,
      schema: loginResponseSchema,
    });
    accessToken.current = result.accessToken;
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    accessToken.current = null;
    setUser(null);
    // No body: the server reads the cookie and clears it. Sent even if it fails,
    // because the local session is already gone either way.
    await apiRequest("/auth/logout", {
      method: "POST",
      body: {},
      schema: z.undefined(),
    }).catch(() => undefined);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, isAuthenticated: user !== null, isRestoring, login, logout }),
    [user, isRestoring, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return context;
}
