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
} from "@accountmanagement/contracts";
import { apiRequest, setAccessTokenProvider } from "../lib/api-client";
import { z } from "zod";

interface AuthState {
  user: AuthenticatedUser | null;
  isAuthenticated: boolean;
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
 * Holds the access token IN MEMORY only.
 *
 * The .NET app wrote the user's cleartext password to a non-HttpOnly, non-Secure
 * cookie for 7 days when "Remember me" was ticked. Nothing here is persisted: a
 * refresh loses the session, which is the correct trade until refresh tokens move
 * to an HttpOnly cookie set by the API.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const accessToken = useRef<string | null>(null);
  const refreshToken = useRef<string | null>(null);

  useEffect(() => {
    setAccessTokenProvider(() => accessToken.current);
  }, []);

  const login = useCallback(async (credentials: LoginRequest) => {
    const result = await apiRequest("/auth/login", {
      method: "POST",
      body: credentials,
      schema: loginResponseSchema,
    });
    accessToken.current = result.accessToken;
    refreshToken.current = result.refreshToken;
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    const token = refreshToken.current;
    accessToken.current = null;
    refreshToken.current = null;
    setUser(null);
    if (token) {
      await apiRequest("/auth/logout", {
        method: "POST",
        body: { refreshToken: token },
        schema: z.undefined(),
      }).catch(() => undefined);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, isAuthenticated: user !== null, login, logout }),
    [user, login, logout],
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
