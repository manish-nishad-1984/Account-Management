import { useRef, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

/**
 * Redirects to the login page, remembering where the user was headed — but only
 * for someone who was never signed in here.
 *
 * A visitor who opens a bookmark to /purchase-orders should land on it after
 * signing in. Somebody whose SESSION ENDED under them — Sign out, 30 minutes
 * idle, expiry, another tab signing out — is different: the next person at that
 * keyboard may not be them, and signing in must not put that person straight back
 * on the page the last one was reading. They start at the front page instead.
 *
 * Told apart by having been signed in at the moment it ended: this element is the
 * one mounted on the page being read, so it sees the transition itself.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();
  const wasSignedIn = useRef(false);
  if (isAuthenticated) wasSignedIn.current = true;

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
    return <Navigate to="/login" replace state={wasSignedIn.current ? undefined : { from: location.pathname }} />;
  }
  return <>{children}</>;
}
