import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";

export const userRowSchema = z.object({
  id: z.string(),
  userName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phoneNo: z.string(),
  isActive: z.boolean(),
  /**
   * True while this user's password is still the plaintext value carried over
   * from SQL Server. Surfaced deliberately: it turns the C-1 remediation into
   * something an administrator can see and chase, not a silent background state.
   */
  passwordIsLegacy: z.boolean(),
  siteCount: z.number().int().nonnegative(),
  capabilities: rowCapabilitiesSchema,
});
export type UserRow = z.infer<typeof userRowSchema>;

export const USER_SORT_FIELDS = ["userName", "firstName", "lastName", "email", "createdAt"] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];
