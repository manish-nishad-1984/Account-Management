import type { ReactNode } from "react";
import type { Right } from "@accountmanagement/contracts";
import { usePermission } from "../../lib/permissions";

interface Props {
  form: string;
  right: Right;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * `<PermissionGate form="Supplier Invoice" right="edit">`
 *
 * Hides UI the user cannot use. This is presentation only — the server refuses the
 * call regardless, which is the difference from the .NET app where the Razor
 * partial was the only check.
 */
export function PermissionGate({ form, right, children, fallback = null }: Props) {
  return usePermission(form, right) ? <>{children}</> : <>{fallback}</>;
}
