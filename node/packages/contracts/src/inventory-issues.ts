import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";
import { optionalText, quantity, uuidId } from "./fields";

/**
 * INVENTORY: STOCK, ISSUE AND RECEIVE BACK (client, 26 Oct 2026).
 *
 *  - The INVENTORY ITEM MASTER is what New Arrival brings in: a name, a unit and
 *    a photo. Its stock at a site is what arrived there, less what is out.
 *  - A PURCHASE ITEM (the Items master) has its own stock at a site: what came
 *    in on the site's inward challans, less what is out. The two never mix.
 *  - An ISSUE gives a quantity of either to a PERSON of an AGENCY (picked, or
 *    added there with a photo and a mobile), through the agency's main contact.
 *    RETURNABLE: it waits on the dashboard until it is received back, and what
 *    comes back goes back into the stock it left. NON-RETURNABLE: it leaves the
 *    stock for good.
 *
 *  STOCK = in - (issued - received back)
 */
export const ISSUE_SOURCES = ["inventory", "purchase"] as const;
export type IssueSource = (typeof ISSUE_SOURCES)[number];

/** A storage key of a photo uploaded for the inventory, as `POST /inventory-photos` hands it back. */
export const photoKeySchema = z.string().regex(/^inventory\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/, "Upload the photo again");
export const photoUploadSchema = z.object({ photoKey: photoKeySchema });
export type PhotoUpload = z.infer<typeof photoUploadSchema>;

// ---- inventory item master -------------------------------------------------

export const inventoryItemRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.string(),
  note: z.string().nullable(),
  hasPhoto: z.boolean(),
  /** In stock at the site asked for (every site when none is): arrived less what is out. */
  stock: z.string(),
  /** Out on returnable issues, waiting to come back. */
  out: z.string(),
  capabilities: rowCapabilitiesSchema,
});
export type InventoryItemRow = z.infer<typeof inventoryItemRowSchema>;

export const saveInventoryItemSchema = z.object({
  name: z.string().trim().min(1, "Enter the item's name").max(200),
  unit: z.string().trim().min(1, "Enter the unit").max(30).default("Nos"),
  note: optionalText(500),
  /** A new photo; leave out to keep the one there is. */
  photoKey: photoKeySchema.nullable().optional(),
});
export type SaveInventoryItem = z.infer<typeof saveInventoryItemSchema>;

// ---- purchase item stock ---------------------------------------------------

export const purchaseStockRowSchema = z.object({
  itemId: z.string(),
  itemName: z.string(),
  unitName: z.string().nullable(),
  /** Came in on the site's inward challans. */
  received: z.string(),
  stock: z.string(),
  out: z.string(),
});
export type PurchaseStockRow = z.infer<typeof purchaseStockRowSchema>;

// ---- agency persons --------------------------------------------------------

export const agencyPersonSchema = z.object({
  id: z.string(),
  agencyId: z.string(),
  name: z.string(),
  mobile: z.string().nullable(),
  hasPhoto: z.boolean(),
});
export type AgencyPerson = z.infer<typeof agencyPersonSchema>;

export const createAgencyPersonSchema = z.object({
  agencyId: uuidId,
  name: z.string().trim().min(1, "Enter the person's name").max(120),
  mobile: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{6,20}$/, "Enter a mobile number")
    .nullable()
    .optional()
    .transform((value) => value || null),
  photoKey: photoKeySchema.nullable().optional(),
});
export type CreateAgencyPerson = z.infer<typeof createAgencyPersonSchema>;

// ---- issues ----------------------------------------------------------------

export const ISSUE_STATUSES = ["out", "returned", "given"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const inventoryIssueRowSchema = z.object({
  id: z.string(),
  siteId: z.string().nullable(),
  siteName: z.string().nullable(),
  source: z.enum(ISSUE_SOURCES),
  inventoryItemId: z.string().nullable(),
  itemId: z.string().nullable(),
  itemName: z.string(),
  unitName: z.string().nullable(),
  quantity: z.string(),
  returnable: z.boolean(),
  agencyId: z.string(),
  agencyName: z.string(),
  contactName: z.string().nullable(),
  contactMobile: z.string().nullable(),
  personId: z.string(),
  personName: z.string(),
  personMobile: z.string().nullable(),
  personHasPhoto: z.boolean(),
  issuedAt: z.string(),
  note: z.string().nullable(),
  returnedQuantity: z.string().nullable(),
  returnedAt: z.string().nullable(),
  returnNote: z.string().nullable(),
  /** OUT: returnable, not back yet. RETURNED: received back. GIVEN: not returnable. */
  status: z.enum(ISSUE_STATUSES),
  capabilities: rowCapabilitiesSchema,
});
export type InventoryIssueRow = z.infer<typeof inventoryIssueRowSchema>;

export const inventoryIssueListSchema = z.object({ rows: z.array(inventoryIssueRowSchema) });

export const inventoryIssueQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(300),
});
export type InventoryIssueQuery = z.infer<typeof inventoryIssueQuerySchema>;

export const createInventoryIssueSchema = z
  .object({
    siteId: uuidId,
    source: z.enum(ISSUE_SOURCES),
    inventoryItemId: uuidId.nullable().optional(),
    itemId: uuidId.nullable().optional(),
    quantity: quantity("Quantity"),
    returnable: z.boolean(),
    agencyId: uuidId,
    agencyContactId: uuidId.nullable().optional(),
    personId: uuidId,
    note: optionalText(500),
  })
  .refine((issue) => (issue.source === "inventory" ? !!issue.inventoryItemId : !!issue.itemId), {
    message: "Choose the item",
    path: ["inventoryItemId"],
  });
export type CreateInventoryIssue = z.infer<typeof createInventoryIssueSchema>;

export const receiveInventoryIssueSchema = z.object({
  /** What came back; less than was issued means the rest did not. */
  quantity: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter the quantity received"),
  note: optionalText(500),
});
export type ReceiveInventoryIssue = z.infer<typeof receiveInventoryIssueSchema>;
