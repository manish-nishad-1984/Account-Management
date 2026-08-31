import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "permissions";

/**
 * Declares the permissions a route requires. Enforced by PermissionsGuard, which
 * is also global — so a route with no @Permissions() and no @Public() is
 * authenticated but grants nothing beyond identity.
 *
 * The .NET API had no per-endpoint authorization at all: every [Authorize] was
 * parameterless and the token carried no claims, so a view-only clerk could
 * approve their own invoices by calling the API directly (assessment §3.3).
 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
