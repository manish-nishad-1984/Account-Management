import { z } from "zod";
import { emailAddress, gstNo, mobileNo, optionalText, panNo, requiredText, uuidId } from "./fields";
import { rowCapabilitiesSchema } from "./pagination";

/**
 * The Client Master (client request, 9 Oct 2026): the party that PAYS US for a
 * project - the owner of the project - as opposed to a supplier, whom we pay.
 *
 * A client is linked to the sites (projects) it pays for. The Income screen
 * offers, for the project in the header, the clients linked to it. A client may
 * pay for several projects and a project may have several clients.
 */
export const clientRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  mobile: z.string().nullable(),
  email: z.string().nullable(),
  gstNo: z.string().nullable(),
  panNo: z.string().nullable(),
  /** The projects this client pays for, by name. */
  siteNames: z.array(z.string()),
  capabilities: rowCapabilitiesSchema,
});
export type ClientRow = z.infer<typeof clientRowSchema>;

export const clientDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  mobile: z.string().nullable(),
  email: z.string().nullable(),
  gstNo: z.string().nullable(),
  panNo: z.string().nullable(),
  address: z.string().nullable(),
  siteIds: z.array(z.string()),
});
export type ClientDetail = z.infer<typeof clientDetailSchema>;

export const createClientSchema = z.object({
  name: requiredText("Client name", 200),
  mobile: mobileNo,
  email: emailAddress,
  gstNo,
  panNo,
  address: optionalText(500),
  siteIds: z.array(uuidId).max(200).default([]),
});
export type CreateClient = z.infer<typeof createClientSchema>;

export const updateClientSchema = createClientSchema.partial();
export type UpdateClient = z.infer<typeof updateClientSchema>;

export const CLIENT_SORT_FIELDS = ["name", "createdAt"] as const;
