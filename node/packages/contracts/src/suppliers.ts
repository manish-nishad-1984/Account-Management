import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";
import {
  emailAddress,
  geographyId,
  gstNo,
  ifscCode,
  mobileNo,
  optionalDate,
  optionalMoney,
  optionalText,
  pincode,
  requiredText,
} from "./fields";

/**
 * Suppliers — `SupplierMaster` in SQL Server.
 *
 * Bank details are omitted from the list row for the same reason they are
 * omitted from the company row: a grid that any `supplier.view` holder can open
 * must not ship every supplier's account number. They live on the detail payload.
 *
 * `openingBalance` IS on the row. It is a ledger figure the person scanning the
 * list is there to see, and unlike an account number it grants nothing.
 */
export const supplierRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  mobile: z.string().nullable(),
  email: z.string().nullable(),
  gstNo: z.string().nullable(),
  area: z.string().nullable(),
  pincode: z.string().nullable(),
  isApproved: z.boolean(),
  /** A decimal string, never a number — see `money` in fields.ts. */
  openingBalance: z.string().nullable(),
  capabilities: rowCapabilitiesSchema,
});
export type SupplierRow = z.infer<typeof supplierRowSchema>;

export const supplierDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  mobile: z.string().nullable(),
  email: z.string().nullable(),
  gstNo: z.string().nullable(),
  buildingName: z.string().nullable(),
  area: z.string(),
  cityId: z.number().int().nullable(),
  stateId: z.number().int().nullable(),
  pincode: z.string().nullable(),
  bankName: z.string().nullable(),
  bankBranch: z.string().nullable(),
  accountNo: z.string().nullable(),
  ifscCode: z.string().nullable(),
  isApproved: z.boolean(),
  openingBalance: z.string().nullable(),
  /** ISO date, or null. */
  openingBalanceDate: z.string().nullable(),
});
export type SupplierDetail = z.infer<typeof supplierDetailSchema>;

export const createSupplierSchema = z
  .object({
    name: requiredText("Supplier name", 200),
    mobile: mobileNo,
    email: emailAddress,
    gstNo,
    buildingName: optionalText(200),
    area: requiredText("Area", 200),
    cityId: geographyId,
    stateId: geographyId,
    pincode,
    bankName: optionalText(200),
    bankBranch: optionalText(200),
    accountNo: optionalText(30),
    ifscCode,
    /**
     * `IsApproved` is carried, not enforced. Nothing in the repository layer
     * treats it as a gate — an unapproved supplier can still be selected on a
     * purchase order — so making it one here would be a behaviour change that
     * needs business sign-off (assessment 07).
     */
    isApproved: z.boolean().default(false),
    openingBalance: optionalMoney("Opening balance"),
    openingBalanceDate: optionalDate,
  })
  .superRefine((value, ctx) => {
    // An opening balance without the date it was struck is not a ledger entry,
    // it is a number. The source stores both and validates neither.
    if (value.openingBalance !== null && value.openingBalanceDate === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["openingBalanceDate"],
        message: "An opening balance needs the date it was taken as at",
      });
    }
  });
export type CreateSupplier = z.infer<typeof createSupplierSchema>;

/**
 * `.partial()` cannot be called on a schema that carries a `superRefine`, so the
 * update shape is built from the inner object and re-refined. The cross-field
 * rule is dropped on PATCH by design: a partial update that touches neither
 * balance field has nothing to check, and one that touches only the date is
 * legitimately correcting it.
 */
export const updateSupplierSchema = createSupplierSchema.innerType().partial();
export type UpdateSupplier = z.infer<typeof updateSupplierSchema>;

export const SUPPLIER_SORT_FIELDS = ["name", "createdAt"] as const;
export type SupplierSortField = (typeof SUPPLIER_SORT_FIELDS)[number];
