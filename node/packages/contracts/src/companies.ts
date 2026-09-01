import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";

/**
 * A company row as the grid needs it — not the whole 20-column record.
 *
 * Bank details (account number, IFSC) are deliberately NOT in the list payload.
 * They are needed on one detail screen and by nothing else, and a list endpoint
 * that ships them puts every company's bank account into the browser of anyone
 * with `company.view`.
 */
export const companyRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** `InvoicePef` in SQL Server — the prefix stamped on this company's invoices. */
  invoicePrefix: z.string().nullable(),
  gstNo: z.string().nullable(),
  panNo: z.string().nullable(),
  area: z.string().nullable(),
  pincode: z.string().nullable(),
  bankName: z.string().nullable(),
  /**
   * Users assigned to this company, from the junction table that replaced the CSV
   * `User.CompanyId`. NOT a count of sites: the source schema has no
   * Company-to-Site relationship to count.
   */
  userCount: z.number().int().nonnegative(),
  capabilities: rowCapabilitiesSchema,
});
export type CompanyRow = z.infer<typeof companyRowSchema>;

export const COMPANY_SORT_FIELDS = ["name", "createdAt"] as const;
export type CompanySortField = (typeof COMPANY_SORT_FIELDS)[number];
