import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";
import { TERMS_MAX_LENGTH, termsTemplateKey } from "./purchase-order-terms";
import {
  money,
  optionalDate,
  optionalMoney,
  optionalPercent,
  optionalText,
  optionalUuidId,
  quantity,
  requiredText,
  uuidId,
} from "./fields";

/**
 * Purchase orders — `PurchaseOrder` / `PurchaseOrderDetail` in SQL Server.
 *
 * The first header-with-lines document in the migration, and the first that
 * carries money.
 *
 * ON B-2. `08-create-purchase-order.md` marks this screen as gated on the GST
 * calculator question. It is not, and the reasoning is recorded in full in
 * `packages/domain/src/purchase-order-total.ts`: the Create Purchase Order view
 * loads ONE calculator script and contains zero occurrences of discount, TDS or
 * round-off, which are the three things the three calculators disagree about.
 * The question stays open for purchase and sales invoices, which is where it
 * bites.
 *
 * TOTALS ARE NOT IN ANY WRITE CONTRACT. The server computes them from the lines
 * and stores them. The source posts browser-computed totals and saves them
 * unchecked, so a crafted request could book an order at any value it liked.
 */

export const purchaseOrderItemRowSchema = z.object({
  id: z.string(),

  /** Null when the line names free text instead of a catalogue item. */
  itemId: z.string().nullable(),
  /** The catalogue name when there is one, else the line's own text. */
  itemLabel: z.string(),
  itemDescription: z.string().nullable(),
  hsnCode: z.string().nullable(),

  unitId: z.number().int(),
  unitName: z.string(),

  /** Decimal STRINGS, all of them. Never parse one to a number. */
  quantity: z.string(),
  unitPrice: z.string(),
  gstPercent: z.string().nullable(),
  gstAmount: z.string(),
  lineTotal: z.string(),

  lineNumber: z.number().int(),
});
export type PurchaseOrderItemRow = z.infer<typeof purchaseOrderItemRowSchema>;

/**
 * WHERE THE ORDER IS DELIVERED, and how much goes to each place.
 *
 * The legacy screen carries two panels under the line grid — "Shipping
 * Addresses", listing the site's addresses, and "Group Address", listing the
 * addresses of the chosen site group. Each row is a checkbox plus a quantity
 * box, and the ticked rows post as ONE list (`ShippingAddressList`) into ONE
 * table, `PodeliveryAddress`.
 *
 * WHICH PANEL A ROW CAME FROM IS A STRING PREFIX IN THE SOURCE.
 *
 * `PurchaseRequestScript.js:1003` posts a group address as
 * `'Group-' + GroupAddress`, and the view reads it back with
 * `a.Address.Replace("Group-", "")` (`CreatePurchaseOrder.cshtml:619`). So the
 * discriminator lives inside the address text, and any real address beginning
 * "Group-" is indistinguishable from a tagged one — while `Replace` strips the
 * marker from ANY position in the string, so an address reading "Ward 3,
 * Group-B" comes back as "Ward 3, B" on the screen that lists it.
 *
 * `kind` is a column here. It is the same fact, stored where it can be queried
 * and where it cannot corrupt the address it describes.
 */
export const DELIVERY_ADDRESS_KINDS = ["site", "group"] as const;
export const deliveryAddressKind = z.enum(DELIVERY_ADDRESS_KINDS);
export type DeliveryAddressKindValue = (typeof DELIVERY_ADDRESS_KINDS)[number];

export const purchaseOrderDeliveryAddressRowSchema = z.object({
  id: z.string(),
  kind: deliveryAddressKind,
  /**
   * A SNAPSHOT, not a reference — as the source stores it.
   *
   * The address is copied onto the order at the moment it is raised, so editing
   * a site or a group later cannot rewrite where an order that has already
   * shipped was sent. That is the right shape for a document of record and it is
   * what `PodeliveryAddress.Address` already is.
   */
  address: z.string(),
  /** Decimal string. See the note on the input schema about the source's `int`. */
  quantity: z.string(),
  lineNumber: z.number().int(),
});
export type PurchaseOrderDeliveryAddressRow = z.infer<
  typeof purchaseOrderDeliveryAddressRowSchema
>;

export const purchaseOrderDeliveryAddressInputSchema = z.object({
  kind: deliveryAddressKind,
  address: requiredText("Address", 500),
  /**
   * QUANTITY IS DECIMAL HERE AND AN `int` IN THE SOURCE.
   *
   * `PodeliveryAddress.Quantity` is `int?`, while the browser collects it with
   * `parseFloat` and every order line quantity is decimal. So a site given 2.5
   * tonnes of an order measured in tonnes is stored as 2 or 3 depending on how
   * SQL Server rounds it, silently, and the delivery quantities then do not add
   * up to the order.
   *
   * Decimal, to match the lines they are allocated from. This cannot change an
   * existing order — the ETL widens a column that only ever held whole numbers.
   */
  quantity: quantity("Delivery quantity"),
});
export type PurchaseOrderDeliveryAddressInput = z.infer<
  typeof purchaseOrderDeliveryAddressInputSchema
>;

/**
 * What the two address panels offer, for one site.
 *
 * ONE REQUEST, because the panels are useless separately: the Group select, the
 * group's addresses and the site's addresses all change together when the site
 * in the header changes, and three requests would let the screen show a group
 * from one site beside addresses from another for as long as the slowest of them
 * took.
 */
export const purchaseOrderDeliveryGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The group's "Multiple Group Address" repeater — `site_group_addresses`. */
  addresses: z.array(z.string()),
});
export type PurchaseOrderDeliveryGroup = z.infer<typeof purchaseOrderDeliveryGroupSchema>;

export const purchaseOrderDeliveryOptionsSchema = z.object({
  /**
   * The site's own addresses, composed from the columns the port holds.
   *
   * KNOWN SHORT OF THE LEGACY SCREEN, and the screen says so rather than
   * pretending. Two reasons, both PLAN.md §1.4 and both waiting on the census:
   *
   *  - The source's primary list is the `SiteAddresses` TABLE, many rows per
   *    site, which has no equivalent here. `sites` carries one main address and
   *    one shipping address, so at most two are on offer where the legacy screen
   *    may show several.
   *  - The legacy string ends `", CityName, StateName, CountryName"`, and those
   *    are bare integer ids here with no lookup table behind them. Including
   *    "13, 7, 1" in a delivery address would be worse than leaving it out.
   *
   * Nothing is invented to fill the gap: an address that cannot be composed is
   * absent, and a site with neither column filled returns an empty list.
   */
  siteAddresses: z.array(z.string()),
  groups: z.array(purchaseOrderDeliveryGroupSchema),
});
export type PurchaseOrderDeliveryOptions = z.infer<typeof purchaseOrderDeliveryOptionsSchema>;

export const purchaseOrderRowSchema = z.object({
  id: z.string(),
  poNo: z.string(),

  siteId: z.string(),
  siteName: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  companyId: z.string(),
  companyName: z.string(),

  documentDate: z.string().nullable(),

  /**
   * The legacy list renders `@item.Poid - @item.BuyersPurchaseNo` in one cell,
   * which is where `07-purchase-orders.md` got the idea that the number carries a
   * free-text suffix. It does not — this is a separate field and it is returned
   * separately, so the number stays a number.
   */
  buyersPurchaseNo: z.string().nullable(),

  /** Server-computed. See the note at the top of this file. */
  subtotal: z.string(),
  totalGstAmount: z.string(),
  totalAmount: z.string(),

  /** How many lines the order has, so the list can say so without fetching them. */
  lineCount: z.number().int(),

  isActive: z.boolean(),
  isApproved: z.boolean(),
  createdAt: z.string(),

  capabilities: rowCapabilitiesSchema,
});
export type PurchaseOrderRow = z.infer<typeof purchaseOrderRowSchema>;

export const purchaseOrderDetailSchema = purchaseOrderRowSchema
  .omit({ capabilities: true, siteName: true, supplierName: true, companyName: true, lineCount: true })
  .extend({
    siteGroupId: z.string().nullable(),

    deliveryDate: z.string().nullable(),
    deliveryImmediate: z.boolean(),

    terms: z.string().nullable(),
    description: z.string().nullable(),
    billingAddress: z.string().nullable(),
    groupAddress: z.string().nullable(),

    contactName: z.string().nullable(),
    contactNumber: z.string().nullable(),
    otherContactName: z.string().nullable(),
    otherContactNumber: z.string().nullable(),
    dispatchBy: z.string().nullable(),
    paymentTerms: z.string().nullable(),

    /** Which of the three boilerplate templates the terms started from. */
    termsTemplate: termsTemplateKey.nullable(),

    /** Carried from the source and never applied to the totals. */
    totalDiscount: z.string().nullable(),

    items: z.array(purchaseOrderItemRowSchema),
    deliveryAddresses: z.array(purchaseOrderDeliveryAddressRowSchema),
  });
export type PurchaseOrderDetail = z.infer<typeof purchaseOrderDetailSchema>;

/**
 * A line as it is written.
 *
 * `gstAmount` and `lineTotal` are absent by construction — they are derived. The
 * source sends them from the browser and stores them without checking, which is
 * what makes its stored totals unverifiable after the fact.
 */
export const purchaseOrderLineInputSchema = z
  .object({
    // An unselected <select> submits "", which a plain nullable uuid rejects as
    // "Not a valid identifier". Same field, same reason, as the challan supplier.
    itemId: optionalUuidId,
    itemName: optionalText(200),
    itemDescription: optionalText(500),
    unitId: z.coerce.number().int().positive("Choose a unit"),
    quantity: quantity("Quantity"),
    unitPrice: money("Price"),
    gstPercent: optionalPercent("GST %"),
    /** Accepted, stored, and deliberately not used in the arithmetic. */
    discount: optionalMoney("Discount"),
  })
  .superRefine((value, ctx) => {
    if (value.itemId === null && value.itemName === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemId"],
        message: "Choose an item, or type a name for one that is not in the catalogue",
      });
    }
  });
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;

/**
 * `poNo` is NOT in the create contract — the server issues it from
 * `document_counters`, per company and financial year, inside the insert's own
 * transaction.
 *
 * The source fetches the number when the form OPENS and posts it back on save,
 * so two open forms submit the same number and nothing refuses it. Worse, its
 * generator returns the string "Error generating Purchase Order number." on any
 * failure, and that sentence would be written to the column.
 */
export const createPurchaseOrderSchema = z.object({
  siteId: uuidId,
  supplierId: uuidId,
  companyId: uuidId,
  siteGroupId: optionalUuidId,

  documentDate: optionalDate,

  /**
   * Delivery: a date, or "immediate". One legacy string column held both.
   *
   * Both may be absent — that is "nobody said", which the source cannot express
   * because its single column conflates it with immediate.
   */
  deliveryDate: optionalDate,
  deliveryImmediate: z.coerce.boolean().default(false),

  buyersPurchaseNo: optionalText(100),
  contactName: optionalText(200),
  contactNumber: optionalText(20),
  otherContactName: optionalText(200),
  otherContactNumber: optionalText(20),
  dispatchBy: optionalText(200),
  paymentTerms: optionalText(500),

  billingAddress: optionalText(500),
  groupAddress: optionalText(500),

  /**
   * HTML, and sanitised on the way in — see `purchase-order-terms.ts` for the
   * allowlist and for why the source's `@Html.Raw` render makes this the one
   * column in the system that must never be trusted as it arrives.
   *
   * The LENGTH is checked here and the MARKUP is checked on the server. A Zod
   * schema is the wrong place to strip tags: it runs in the browser too, and a
   * sanitiser that a caller can skip by posting directly is not a sanitiser.
   */
  terms: optionalText(TERMS_MAX_LENGTH),
  /** Null when the terms were typed from scratch rather than from a template. */
  termsTemplate: termsTemplateKey.nullable().optional().default(null),
  description: optionalText(2000),

  items: z
    .array(purchaseOrderLineInputSchema)
    .min(1, "Add at least one product")
    .max(200, "An order cannot carry more than 200 lines"),

  /**
   * Empty is normal — the source saves orders with no delivery address at all,
   * and an order whose deliveries are not yet decided is an ordinary state.
   *
   * The rule that the quantities may not exceed what was ordered is NOT here.
   * It compares sums of decimal strings, which is `packages/domain`'s job:
   * `deliveryAllocation.allocate`. Doing it in a refinement would mean parsing
   * money to a float in the validation layer, which this system does nowhere.
   */
  deliveryAddresses: z
    .array(purchaseOrderDeliveryAddressInputSchema)
    .max(100, "An order cannot carry more than 100 delivery addresses")
    .optional()
    .default([]),
});
export type CreatePurchaseOrder = z.infer<typeof createPurchaseOrderSchema>;

/**
 * Update carries no `poNo`: a document's number is fixed once issued.
 *
 * `items` is all-or-nothing — send the whole set or none of it. A partial line
 * update would need stable client-side line identity, and the grid does not have
 * it; the source solves this by deleting every detail row and re-inserting,
 * which is what this does inside one transaction.
 */
export const updatePurchaseOrderSchema = createPurchaseOrderSchema.partial();
export type UpdatePurchaseOrder = z.infer<typeof updatePurchaseOrderSchema>;

/**
 * `poNo` sorts as text. Unlike `prNo` that is NOT document order across
 * companies — `DEMO/PO/24-25/002` sorts before `DHP/PO/24-25/001` — but it is
 * document order within one company, which is how the list is read.
 */
export const PURCHASE_ORDER_SORT_FIELDS = ["poNo", "createdAt", "totalAmount"] as const;
export type PurchaseOrderSortField = (typeof PURCHASE_ORDER_SORT_FIELDS)[number];
