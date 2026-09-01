import { hasPermission, type Right } from "@accountmanagement/contracts";
import { useAuth } from "../contexts/AuthContext";

/**
 * `usePermission('Supplier Invoice', 'edit')`
 *
 * UI hint only. The server enforces the same permission again via
 * PermissionsGuard — hiding a button is a convenience, not a control.
 */
export function usePermission(subject: string, right: Right): boolean {
  const { user } = useAuth();
  return user ? hasPermission(user.permissions, subject, right) : false;
}
