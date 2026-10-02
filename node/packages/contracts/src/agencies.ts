import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";
import { requiredGeographyId } from "./geography";
import {
  emailAddress,
  gstNo,
  ifscCode,
  optionalText,
  panNo,
  phoneNumbers,
  requiredText,
} from "./fields";

/**
 * Agency Master — the contractors who work on a site (client request, 1 Oct
 * 2026, from a mockup). New: there is no legacy screen behind it.
 *
 * As with suppliers, bank details are not on the list row: a grid any
 * `agency.view` holder can open must not ship every agency's account number.
 */

/** A trade an agency can be booked for — Plaster, Shuttering, Plumbing. */
export const workTypeSchema = z.object({ id: z.number().int(), name: z.string() });
export type WorkType = z.infer<typeof workTypeSchema>;

export const createWorkTypeSchema = z.object({ name: requiredText("Work type", 100) });
export type CreateWorkType = z.infer<typeof createWorkTypeSchema>;

export const agencyContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  designation: z.string().nullable(),
  mobile: z.string().nullable(),
  email: z.string().nullable(),
});
export type AgencyContact = z.infer<typeof agencyContactSchema>;

/** An additional contact: a name, and whatever else is known. */
export const agencyContactInputSchema = z.object({
  name: requiredText("Contact name", 200),
  designation: optionalText(100),
  mobile: phoneNumbers,
  email: emailAddress,
});
export type AgencyContactInput = z.infer<typeof agencyContactInputSchema>;

/** The primary contact also needs a number — it is who the site calls. */
export const agencyPrimaryContactInputSchema = agencyContactInputSchema.extend({
  mobile: phoneNumbers.refine((value) => value !== null, "Mobile number is required"),
});

export const agencyRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  workTypes: z.array(workTypeSchema),
  cityName: z.string().nullable(),
  stateName: z.string().nullable(),
  primaryContactName: z.string().nullable(),
  primaryContactMobile: z.string().nullable(),
  isActive: z.boolean(),
  capabilities: rowCapabilitiesSchema,
});
export type AgencyRow = z.infer<typeof agencyRowSchema>;

export const agencyDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  workTypeIds: z.array(z.number().int()),
  address: z.string().nullable(),
  stateId: z.number().int(),
  cityId: z.number().int(),
  gstNo: z.string().nullable(),
  panNo: z.string().nullable(),
  bankName: z.string().nullable(),
  accountNo: z.string().nullable(),
  ifscCode: z.string().nullable(),
  accountHolderName: z.string().nullable(),
  isActive: z.boolean(),
  primaryContact: agencyContactSchema.nullable(),
  additionalContacts: z.array(agencyContactSchema),
});
export type AgencyDetail = z.infer<typeof agencyDetailSchema>;

export const createAgencySchema = z.object({
  name: requiredText("Agency name", 200),
  workTypeIds: z
    .array(z.number().int().positive())
    .min(1, "Choose at least one work type")
    .max(30, "Choose at most 30 work types"),
  address: optionalText(500),
  stateId: requiredGeographyId("state"),
  cityId: requiredGeographyId("city"),
  gstNo,
  panNo,
  bankName: optionalText(200),
  accountNo: optionalText(30),
  ifscCode,
  accountHolderName: optionalText(200),
  isActive: z.boolean().default(true),
  primaryContact: agencyPrimaryContactInputSchema,
  additionalContacts: z
    .array(agencyContactInputSchema)
    .max(20, "An agency can list at most 20 additional contacts")
    .default([]),
});
export type CreateAgency = z.infer<typeof createAgencySchema>;

/**
 * Every field optional on PATCH. `additionalContacts` loses its default, so a
 * patch that does not mention contacts leaves them alone rather than clearing
 * them — the trap §5w recorded on purchase orders.
 */
export const updateAgencySchema = createAgencySchema
  .extend({ additionalContacts: z.array(agencyContactInputSchema).max(20).optional() })
  .partial();
export type UpdateAgency = z.infer<typeof updateAgencySchema>;

/** The three count tiles, and the cities the City filter offers. */
export const agencySummarySchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  inactive: z.number().int(),
  cities: z.array(z.object({ id: z.number().int(), name: z.string() })),
});
export type AgencySummary = z.infer<typeof agencySummarySchema>;

export const AGENCY_SORT_FIELDS = ["name", "createdAt"] as const;
export type AgencySortField = (typeof AGENCY_SORT_FIELDS)[number];
