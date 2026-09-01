/**
 * Permission strings are `${subject}.${right}`, derived on the server from the
 * per-form boolean columns the existing schema already uses.
 *
 * These are UI HINTS ONLY. Every one of them is enforced again on the server by
 * PermissionsGuard. The .NET app checked permissions inside Razor partials and
 * nowhere else, which is why a view-only clerk could approve their own invoices
 * by calling the API directly.
 */
export const RIGHTS = ["view", "add", "edit", "delete", "approve"] as const;
export type Right = (typeof RIGHTS)[number];

export const permission = (subject: string, right: Right): string =>
  `${subject.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.${right}`;

export const hasPermission = (
  granted: readonly string[],
  subject: string,
  right: Right,
): boolean => granted.includes(permission(subject, right));
