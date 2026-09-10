import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

/** Redirects to the login page, remembering where the user was headed. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();

  /**
   * WAIT. On a page load the access token is not in memory yet — it is being
   * fetched with the refresh cookie — so `isAuthenticated` is false for a moment
   * even for someone who is signed in.
   *
   * Redirecting during that moment is not a harmless flicker: `Navigate` with
   * `replace` rewrites the URL, so the reader loses the page they reloaded and
   * lands on the login screen. That was the whole reported symptom.
   */
  if (isRestoring) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-screen items-center justify-center text-sm text-slate-500"
      >
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
