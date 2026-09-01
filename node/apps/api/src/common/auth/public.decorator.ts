import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Marks a route as reachable without authentication.
 *
 * The default is the opposite: AuthGuard is registered globally via APP_GUARD, so
 * every route requires a valid token unless it opts out here. This inverts the
 * .NET model, where `[Authorize]` was a decorator someone had to remember — and on
 * FormPermissionMasterController, did not (assessment finding C-6: two
 * unauthenticated endpoints that grant administrator rights).
 *
 * Every use of @Public() should be obvious and reviewable in a diff.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
