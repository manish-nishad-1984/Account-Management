import { z } from "zod";

/**
 * Request and response shapes shared by the API and the web client.
 *
 * One definition, imported by both sides, so a change to the contract breaks the
 * build rather than surfacing as a runtime shape mismatch. The .NET/jQuery pair
 * had no shared contract at all: the browser built request bodies by hand and the
 * server bound whatever arrived.
 */

export const loginRequestSchema = z.object({
  userName: z.string().min(1, "Username is required").max(100),
  password: z.string().min(1, "Password is required").max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * The refresh token travels in an HttpOnly cookie, not in a body, so this is
 * optional: `/auth/refresh` and `/auth/logout` read the cookie, and fall back to
 * the body only for a caller that is not a browser.
 */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const authenticatedUserSchema = z.object({
  id: z.string(),
  userName: z.string(),
  permissions: z.array(z.string()),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

/**
 * THE REFRESH TOKEN IS NOT IN HERE, deliberately.
 *
 * It used to be, and the browser held it in a JavaScript variable alongside the
 * access token. That had two consequences: script running on the page could read
 * a 30-day credential, and nothing survived a page reload, so every refresh
 * dropped the user back at the login screen.
 *
 * It now travels only in an HttpOnly, SameSite cookie scoped to the auth routes,
 * which JavaScript cannot read and the browser keeps across reloads. Putting it
 * in this body as well would give the cookie's protection away.
 */
export const loginResponseSchema = z.object({
  accessToken: z.string(),
  user: authenticatedUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const currentUserSchema = z.object({
  id: z.string().optional(),
  permissions: z.array(z.string()),
  siteIds: z.array(z.string()),
  companyIds: z.array(z.string()),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;
