import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";
import {
  geographyId,
  gstNo,
  ifscCode,
  optionalText,
  panNo,
  pincode,
  requiredText,
} from "./fields";

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

/**
 * The full record, for the edit form.
 *
 * This is the ONE payload that carries the bank account number and IFSC, and it
 * is reached only by `GET /companies/:id` — one company per request, still behind
 * `company.view`. The list endpoint deliberately does not ship them, so reading
 * every company's bank details costs one request each and shows up in the logs
 * as exactly that.
 */
export const companyDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  invoicePrefix: z.string().nullable(),
  gstNo: z.string().nullable(),
  panNo: z.string().nullable(),
  address: z.string().nullable(),
  area: z.string().nullable(),
  cityId: z.number().int().nullable(),
  stateId: z.number().int().nullable(),
  countryId: z.number().int().nullable(),
  pincode: z.string().nullable(),
  bankName: z.string().nullable(),
  bankBranch: z.string().nullable(),
  accountNo: z.string().nullable(),
  ifscCode: z.string().nullable(),
});
export type CompanyDetail = z.infer<typeof companyDetailSchema>;

/**
 * What a create accepts.
 *
 * `updateCompanySchema` is this made partial, so a PATCH can carry one field
 * without the caller reconstructing the whole record — which is what stops a
 * form that never loaded the bank details from blanking them on save.
 */
export const createCompanySchema = z.object({
  name: requiredText("Company name", 200),
  invoicePrefix: optionalText(10),
  gstNo,
  panNo,
  address: optionalText(500),
  area: optionalText(200),
  cityId: geographyId,
  stateId: geographyId,
  countryId: geographyId,
  pincode,
  bankName: optionalText(200),
  bankBranch: optionalText(200),
  accountNo: optionalText(30),
  ifscCode,
});
export type CreateCompany = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema.partial();
export type UpdateCompany = z.infer<typeof updateCompanySchema>;

export const COMPANY_SORT_FIELDS = ["name", "createdAt"] as const;
export type CompanySortField = (typeof COMPANY_SORT_FIELDS)[number];
