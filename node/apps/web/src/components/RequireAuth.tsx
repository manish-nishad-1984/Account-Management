import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

/** Redirects to the login page, remembering where the user was headed. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
