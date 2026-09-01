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

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const authenticatedUserSchema = z.object({
  id: z.string(),
  userName: z.string(),
  permissions: z.array(z.string()),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
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
