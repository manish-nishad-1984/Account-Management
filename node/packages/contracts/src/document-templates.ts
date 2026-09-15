import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";
import { optionalUuidId, requiredText } from "./fields";

/**
 * Document templates — how a printed invoice looks.
 *
 * NEW, with no source in the .NET app. The old app has one fixed print page per
 * document (`PrintSalesInvoiceDetails.cshtml`, `InvoicePrintDetails.cshtml`)
 * and no way to change it. The client asked for a layout master like the one in
 * their billing software (14 Sep 2026): templates per document type, one of
 * them the default, each built from blocks placed in rows and columns.
 *
 * A TEMPLATE IS DATA, NOT CODE. The layout below is stored as JSON and drawn by
 * one renderer in the web app, which the list thumbnails, the preview and the
 * printed page all share — so what someone designs is what prints.
 *
 * `version` is on the layout from the first row stored, so a later change to
 * the block model can recognise and upgrade an old layout rather than guess.
 */

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

/**
 * The documents that can be printed from a template.
 *
 * Credit notes and returns are NOT separate types: in this app they are an
 * `invoiceType` inside a sales or purchase invoice, and they print with the
 * invoice's template. The title changes with the type (see `printTitle`).
 */
export const DOCUMENT_TYPES = ["sales-invoice", "purchase-invoice"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  "sales-invoice": "Sales Invoice",
  "purchase-invoice": "Purchase Invoice",
};

/**
 * The title printed at the top when a template does not set its own.
 *
 * The source printed the raw `InvoiceType` — "Sales" — as the heading of a tax
 * invoice. These are what the documents are called.
 */
export function printTitle(documentType: DocumentType, invoiceType: string): string {
  switch (invoiceType) {
    case "Credit Note":
      return "CREDIT NOTE";
    case "Sales Return":
      return "SALES RETURN";
    case "Purchase Return":
      return "PURCHASE RETURN";
    default:
      return documentType === "sales-invoice" ? "TAX INVOICE" : "PURCHASE INVOICE";
  }
}

// ---------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour like #0f766e");
const blockId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Not a valid block id");
const align = z.enum(["left", "center", "right"]);

export const TEMPLATE_FONTS = ["Inter", "Arial", "Georgia", "Times New Roman"] as const;
export type TemplateFont = (typeof TEMPLATE_FONTS)[number];

export const PAGE_SIZES = ["A4", "A5", "Letter"] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** Millimetres, portrait. Landscape swaps them. */
export const PAGE_DIMENSIONS_MM: Record<PageSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 216, height: 279 },
};

export const templatePageSchema = z.object({
  size: z.enum(PAGE_SIZES).default("A4"),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  marginMm: z.number().min(0).max(30).default(10),
});
export type TemplatePage = z.infer<typeof templatePageSchema>;

export const templateStylesSchema = z.object({
  primaryColor: hexColor.default("#0f766e"),
  accentColor: hexColor.default("#14b8a6"),
  textColor: hexColor.default("#111827"),
  fontFamily: z.enum(TEMPLATE_FONTS).default("Inter"),
  /** Points, because that is what print is measured in. */
  baseFontSize: z.number().min(7).max(14).default(9),
  /** Vertical padding of a table cell, in pixels. */
  tableRowSpacing: z.number().min(0).max(10).default(3),
  /** `grid` rules every cell, `lines` only rows, `striped` shades alternate rows. */
  tableStyle: z.enum(["grid", "lines", "striped"]).default("grid"),
  /** A border round every row — the boxed look of the old invoice. */
  boxed: z.boolean().default(false),
});
export type TemplateStyles = z.infer<typeof templateStylesSchema>;

export const COLOR_THEMES: Array<{
  name: string;
  primaryColor: string;
  accentColor: string;
}> = [
  { name: "Professional Blue", primaryColor: "#1d4ed8", accentColor: "#0f766e" },
  { name: "Modern Purple", primaryColor: "#6d28d9", accentColor: "#2563eb" },
  { name: "Warm Earth", primaryColor: "#9a3412", accentColor: "#b45309" },
  { name: "Classic Monochrome", primaryColor: "#1f2937", accentColor: "#4b5563" },
  { name: "Forest Green", primaryColor: "#15803d", accentColor: "#0f766e" },
  { name: "Coral Red", primaryColor: "#dc2626", accentColor: "#ea580c" },
  { name: "Ocean Teal", primaryColor: "#0f766e", accentColor: "#0369a1" },
  { name: "Elegant Rose", primaryColor: "#be185d", accentColor: "#9333ea" },
];

/** The header fields a Document Fields block can show, in the order offered. */
export const DOCUMENT_FIELDS = [
  "number",
  "date",
  "invoice-type",
  "party-invoice-no",
  "purchase-order-no",
  "challan-no",
  "lr-no",
  "vehicle-no",
  "dispatch-by",
  "payment-terms",
  "site",
  "site-group",
  "contact",
] as const;
export type DocumentField = (typeof DOCUMENT_FIELDS)[number];

export const DOCUMENT_FIELD_LABELS: Record<DocumentField, string> = {
  number: "Invoice No",
  date: "Date",
  "invoice-type": "Type",
  "party-invoice-no": "Party invoice No",
  "purchase-order-no": "PO No",
  "challan-no": "Challan No",
  "lr-no": "LR No",
  "vehicle-no": "Vehicle No",
  "dispatch-by": "Dispatched by",
  "payment-terms": "Payment terms",
  site: "Site",
  "site-group": "Site location",
  contact: "Contact",
};

/** The columns an Items Table block can show, in the order offered. */
export const ITEM_COLUMNS = [
  "index",
  "item",
  "hsn",
  "quantity",
  "unit",
  "rate",
  "discount",
  "discount-percent",
  "taxable",
  "gst-percent",
  "gst-amount",
  "amount",
] as const;
export type ItemColumn = (typeof ITEM_COLUMNS)[number];

export const ITEM_COLUMN_LABELS: Record<ItemColumn, string> = {
  index: "#",
  item: "Item",
  hsn: "HSN/SAC",
  quantity: "Qty",
  unit: "Unit",
  rate: "Rate",
  discount: "Disc/unit",
  "discount-percent": "Disc %",
  taxable: "Taxable",
  "gst-percent": "GST %",
  "gst-amount": "GST",
  amount: "Amount",
};

export const TOTAL_ROWS = ["subtotal", "discount", "gst", "cgst-sgst", "tds", "round-off"] as const;
export type TotalRow = (typeof TOTAL_ROWS)[number];

const block = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ id: blockId, type: z.literal(type), ...shape });

export const templateBlockSchema = z.discriminatedUnion("type", [
  block("title", {
    /** Null prints the document's own title — TAX INVOICE, CREDIT NOTE. */
    text: z.string().trim().max(60).nullable().default(null),
    align: align.default("center"),
    variant: z.enum(["plain", "banner"]).default("plain"),
  }),
  block("company", {
    align: align.default("left"),
    nameSize: z.enum(["md", "lg", "xl"]).default("lg"),
    showAddress: z.boolean().default(true),
    showGstin: z.boolean().default(true),
    showPan: z.boolean().default(false),
    showState: z.boolean().default(true),
  }),
  block("party", {
    heading: z.string().trim().max(40).default("Bill to"),
    showAddress: z.boolean().default(true),
    showGstin: z.boolean().default(true),
    showState: z.boolean().default(true),
    showContact: z.boolean().default(false),
  }),
  block("shipping", {
    heading: z.string().trim().max(40).default("Ship to"),
  }),
  block("document-fields", {
    fields: z.array(z.enum(DOCUMENT_FIELDS)).max(DOCUMENT_FIELDS.length).default(["number", "date"]),
    /** Only fields with a value print; an empty challan number leaves no blank row. */
    hideEmpty: z.boolean().default(true),
    align: align.default("left"),
  }),
  block("items-table", {
    columns: z.array(z.enum(ITEM_COLUMNS)).min(1).max(ITEM_COLUMNS.length),
    showDescription: z.boolean().default(true),
    showTotalRow: z.boolean().default(true),
  }),
  block("tax-summary", {
    /** `cgst-sgst` is what the old invoice printed, for every invoice. */
    split: z.enum(["cgst-sgst", "igst", "gst"]).default("cgst-sgst"),
    showHsn: z.boolean().default(true),
  }),
  block("totals", {
    rows: z.array(z.enum(TOTAL_ROWS)).max(TOTAL_ROWS.length).default(["subtotal", "gst", "round-off"]),
    /** Rows that are zero — no TDS, no round-off — are left out. */
    hideZero: z.boolean().default(true),
  }),
  block("amount-in-words", {
    /** The invoice total, the GST on it, or both — the old invoice printed both, apart. */
    show: z.enum(["amount", "tax", "both"]).default("amount"),
  }),
  block("bank-details", {
    heading: z.string().trim().max(40).default("Bank details"),
  }),
  block("notes", {
    /** The invoice's own description box. */
    heading: z.string().trim().max(40).default("Notes"),
  }),
  block("text", {
    heading: z.string().trim().max(60).nullable().default(null),
    body: z.string().max(2000).default(""),
    align: align.default("left"),
  }),
  block("signature", {
    label: z.string().trim().max(60).default("Authorised Signatory"),
    showCompany: z.boolean().default(true),
    align: align.default("right"),
  }),
  block("divider", {}),
  block("spacer", {
    heightMm: z.number().min(1).max(60).default(6),
  }),
]);
export type TemplateBlock = z.infer<typeof templateBlockSchema>;
export type TemplateBlockType = TemplateBlock["type"];

export const templateColumnSchema = z.object({
  id: blockId,
  /** Relative width. Two columns of 2 and 1 are two thirds and one third. */
  weight: z.number().int().min(1).max(6).default(1),
  blocks: z.array(templateBlockSchema).max(20),
});
export type TemplateColumn = z.infer<typeof templateColumnSchema>;

export const templateRowSchema = z.object({
  id: blockId,
  columns: z.array(templateColumnSchema).min(1).max(3),
});
export type TemplateRow = z.infer<typeof templateRowSchema>;

export const templateLayoutSchema = z.object({
  version: z.literal(1),
  page: templatePageSchema,
  styles: templateStylesSchema,
  rows: z.array(templateRowSchema).max(40),
});
export type TemplateLayout = z.infer<typeof templateLayoutSchema>;
export type TemplateLayoutInput = z.input<typeof templateLayoutSchema>;

// ---------------------------------------------------------------------------
// Starter layouts
// ---------------------------------------------------------------------------

export const TEMPLATE_PRESETS = ["classic", "compact", "modern", "minimal"] as const;
export type TemplatePreset = (typeof TEMPLATE_PRESETS)[number];

export const TEMPLATE_PRESET_LABELS: Record<TemplatePreset | "custom", string> = {
  classic: "Classic",
  compact: "Compact",
  modern: "Modern",
  minimal: "Minimal",
  custom: "Custom",
};

let presetSeq = 0;
const id = (prefix: string) => `${prefix}-${(presetSeq++).toString(36)}`;
const row = (...columns: Array<{ weight?: number; blocks: z.input<typeof templateBlockSchema>[] }>) => ({
  id: id("row"),
  columns: columns.map((column) => ({ id: id("col"), weight: column.weight ?? 1, blocks: column.blocks.map((b) => ({ ...b, id: id("blk") })) })),
});
type B = Omit<z.input<typeof templateBlockSchema>, "id">;
const b = <T extends B>(value: T) => value as unknown as z.input<typeof templateBlockSchema>;

const partyHeading = (documentType: DocumentType) =>
  documentType === "sales-invoice" ? "Buyer (Bill to)" : "Supplier";

const INVOICE_FIELDS = (documentType: DocumentType): DocumentField[] =>
  documentType === "sales-invoice"
    ? ["number", "date", "challan-no", "lr-no", "vehicle-no", "dispatch-by", "payment-terms", "site"]
    : ["number", "party-invoice-no", "date", "purchase-order-no", "challan-no", "lr-no", "vehicle-no", "site"];

/**
 * A starter layout, ready to save as a template.
 *
 * `classic` is the old app's printed invoice, block for block: boxed, company
 * top left, the invoice's reference fields beside it, buyer and consignee, the
 * lines with HSN, a CGST/SGST summary by rate, both amounts in words, the bank
 * details, the declaration and the signatory. People have been reading that
 * page for years; the first template should not surprise them.
 */
export function presetLayout(preset: TemplatePreset, documentType: DocumentType): TemplateLayout {
  presetSeq = 0;
  const heading = partyHeading(documentType);
  const fields = INVOICE_FIELDS(documentType);

  const rows = (() => {
    switch (preset) {
      case "classic":
        return {
          styles: { primaryColor: "#1f2937", accentColor: "#4b5563", fontFamily: "Arial", baseFontSize: 8.5, tableStyle: "grid", boxed: true },
          rows: [
            row({ blocks: [b({ type: "title", variant: "plain", align: "center" })] }),
            row(
              { blocks: [b({ type: "company", nameSize: "lg" })] },
              { blocks: [b({ type: "document-fields", fields })] },
            ),
            row(
              { blocks: [b({ type: "party", heading })] },
              { blocks: [b({ type: "shipping", heading: "Consignee (Ship to)" })] },
            ),
            row({ blocks: [b({ type: "items-table", columns: ["index", "item", "hsn", "quantity", "rate", "unit", "discount", "gst-percent", "amount"] })] }),
            row({ blocks: [b({ type: "totals", rows: ["subtotal", "discount", "cgst-sgst", "tds", "round-off"] }), b({ type: "amount-in-words" })] }),
            row({ blocks: [b({ type: "tax-summary", split: "cgst-sgst", showHsn: true }), b({ type: "amount-in-words", show: "tax" })] }),
            row(
              {
                blocks: [
                  b({ type: "bank-details", heading: "Company's Bank Details" }),
                  b({ type: "text", heading: "Declaration", body: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct." }),
                ],
              },
              { blocks: [b({ type: "signature", label: "Authorised Signatory" })] },
            ),
            row({ blocks: [b({ type: "text", body: "This is a Computer Generated Invoice", align: "center" })] }),
          ],
        };
      case "compact":
        return {
          styles: { primaryColor: "#0f766e", accentColor: "#14b8a6", baseFontSize: 8, tableStyle: "striped", tableRowSpacing: 2 },
          rows: [
            row(
              { blocks: [b({ type: "company", nameSize: "md", showState: false })] },
              { blocks: [b({ type: "title", variant: "banner" })] },
              { blocks: [b({ type: "document-fields", fields: ["number", "date", "challan-no", "vehicle-no"], align: "right" })] },
            ),
            row({ blocks: [b({ type: "divider" })] }),
            row(
              { blocks: [b({ type: "party", heading, showState: false })] },
              { blocks: [b({ type: "shipping" })] },
            ),
            row({ blocks: [b({ type: "items-table", columns: ["index", "item", "quantity", "unit", "rate", "gst-percent", "amount"], showDescription: false })] }),
            row(
              { weight: 3, blocks: [b({ type: "amount-in-words" }), b({ type: "bank-details" })] },
              { weight: 2, blocks: [b({ type: "totals", rows: ["subtotal", "discount", "gst", "tds", "round-off"] })] },
            ),
            row({ blocks: [b({ type: "signature" })] }),
          ],
        };
      case "modern":
        return {
          styles: { primaryColor: "#6d28d9", accentColor: "#2563eb", baseFontSize: 9, tableStyle: "lines", tableRowSpacing: 4 },
          rows: [
            row(
              { weight: 3, blocks: [b({ type: "company", nameSize: "xl" })] },
              { weight: 2, blocks: [b({ type: "title", align: "right", variant: "plain" }), b({ type: "document-fields", fields, align: "right" })] },
            ),
            row({ blocks: [b({ type: "spacer", heightMm: 4 })] }),
            row(
              { blocks: [b({ type: "party", heading, showContact: true })] },
              { blocks: [b({ type: "shipping" })] },
            ),
            row({ blocks: [b({ type: "items-table", columns: ["index", "item", "hsn", "quantity", "unit", "rate", "discount", "taxable", "gst-percent", "gst-amount", "amount"] })] }),
            row(
              { weight: 3, blocks: [b({ type: "tax-summary", split: "cgst-sgst", showHsn: false }), b({ type: "notes" })] },
              { weight: 2, blocks: [b({ type: "totals", rows: ["subtotal", "discount", "cgst-sgst", "tds", "round-off"] }), b({ type: "amount-in-words" })] },
            ),
            row(
              { blocks: [b({ type: "bank-details" })] },
              { blocks: [b({ type: "signature" })] },
            ),
          ],
        };
      case "minimal":
        return {
          styles: { primaryColor: "#111827", accentColor: "#6b7280", baseFontSize: 9, tableStyle: "lines", tableRowSpacing: 4 },
          rows: [
            row(
              { blocks: [b({ type: "company", nameSize: "md", showState: false })] },
              { blocks: [b({ type: "title", align: "right" }), b({ type: "document-fields", fields: ["number", "date"], align: "right" })] },
            ),
            row({ blocks: [b({ type: "spacer", heightMm: 6 })] }),
            row({ blocks: [b({ type: "party", heading, showState: false })] }),
            row({ blocks: [b({ type: "items-table", columns: ["index", "item", "quantity", "rate", "amount"], showDescription: false })] }),
            row(
              { weight: 3, blocks: [] },
              { weight: 2, blocks: [b({ type: "totals", rows: ["subtotal", "gst", "round-off"] })] },
            ),
            row({ blocks: [b({ type: "amount-in-words" })] }),
          ],
        };
    }
  })();

  return templateLayoutSchema.parse({
    version: 1,
    page: {},
    styles: rows.styles,
    rows: rows.rows,
  });
}

// ---------------------------------------------------------------------------
// Stored templates
// ---------------------------------------------------------------------------

export const documentTemplateSchema = z.object({
  id: z.string(),
  documentType: z.enum(DOCUMENT_TYPES),
  /** Null means every company. */
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  name: z.string(),
  /** The starter it was made from, shown on the card: "A4 portrait · Classic". */
  basedOn: z.enum([...TEMPLATE_PRESETS, "custom"]),
  isDefault: z.boolean(),
  layout: templateLayoutSchema,
  updatedAt: z.string(),
  capabilities: rowCapabilitiesSchema,
});
export type DocumentTemplate = z.infer<typeof documentTemplateSchema>;

export const documentTemplateListSchema = z.object({
  rows: z.array(documentTemplateSchema),
});
export type DocumentTemplateList = z.infer<typeof documentTemplateListSchema>;

export const documentTemplateListQuerySchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
});

export const createDocumentTemplateSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  companyId: optionalUuidId,
  name: requiredText("Template name", 100),
  basedOn: z.enum([...TEMPLATE_PRESETS, "custom"]).default("custom"),
  layout: templateLayoutSchema,
});
export type CreateDocumentTemplate = z.input<typeof createDocumentTemplateSchema>;

export const updateDocumentTemplateSchema = z
  .object({
    companyId: optionalUuidId,
    name: requiredText("Template name", 100),
    layout: templateLayoutSchema,
  })
  .partial();
export type UpdateDocumentTemplate = z.input<typeof updateDocumentTemplateSchema>;

/** Templates are few per document type; the list is not paged. */
export const DOCUMENT_TEMPLATE_LIMIT = 200;

// ---------------------------------------------------------------------------
// What a template is drawn with
// ---------------------------------------------------------------------------

const nullableText = z.string().nullable();

export const printCompanySchema = z.object({
  name: z.string(),
  address: nullableText,
  gstNo: nullableText,
  panNo: nullableText,
  stateName: nullableText,
  stateCode: nullableText,
  bankName: nullableText,
  bankBranch: nullableText,
  accountNo: nullableText,
  ifscCode: nullableText,
});
export type PrintCompany = z.infer<typeof printCompanySchema>;

export const printPartySchema = z.object({
  name: z.string(),
  address: nullableText,
  gstNo: nullableText,
  stateName: nullableText,
  stateCode: nullableText,
  mobile: nullableText,
  email: nullableText,
});
export type PrintParty = z.infer<typeof printPartySchema>;

export const printLineSchema = z.object({
  lineNumber: z.number().int(),
  name: z.string(),
  description: nullableText,
  hsnCode: nullableText,
  quantity: z.string(),
  unitName: z.string(),
  unitPrice: z.string(),
  discountPerUnit: z.string(),
  discountPercent: z.string(),
  gstPercent: nullableText,
  gstAmount: z.string(),
  netAmount: z.string(),
  lineTotal: z.string(),
});
export type PrintLine = z.infer<typeof printLineSchema>;

export const printTaxRowSchema = z.object({
  gstPercent: z.string(),
  halfPercent: z.string(),
  hsnCodes: z.array(z.string()),
  taxableValue: z.string(),
  gstAmount: z.string(),
  centralTax: z.string(),
  stateTax: z.string(),
});

export const printDocumentSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  id: z.string(),
  companyId: z.string(),
  invoiceType: z.string(),
  title: z.string(),
  number: z.string(),
  date: nullableText,
  fields: z.object({
    partyInvoiceNo: nullableText,
    purchaseOrderNo: nullableText,
    challanNo: nullableText,
    lrNo: nullableText,
    vehicleNo: nullableText,
    dispatchBy: nullableText,
    paymentTerms: nullableText,
    siteName: nullableText,
    siteLocationName: nullableText,
    contactName: nullableText,
    contactNumber: nullableText,
  }),
  description: nullableText,
  shippingAddress: nullableText,
  company: printCompanySchema,
  party: printPartySchema,
  lines: z.array(printLineSchema),
  totals: z.object({
    totalQuantity: z.string(),
    subtotal: z.string(),
    totalDiscount: z.string(),
    totalGstAmount: z.string(),
    tds: z.string(),
    roundOff: z.string(),
    totalAmount: z.string(),
  }),
  taxSummary: z.object({
    rows: z.array(printTaxRowSchema),
    taxableValue: z.string(),
    gstAmount: z.string(),
    centralTax: z.string(),
    stateTax: z.string(),
  }),
  amountInWords: z.string(),
  taxInWords: z.string(),
});
export type PrintDocument = z.infer<typeof printDocumentSchema>;

/**
 * Everything the print page needs, in one response: the document, and the
 * templates that may print it.
 *
 * The templates come WITH the document, under the document's own permission,
 * because printing an invoice must not need the right to manage templates.
 * Only this company's templates and the every-company ones are included.
 */
export const printBundleSchema = z.object({
  document: printDocumentSchema,
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      companyId: z.string().nullable(),
      isDefault: z.boolean(),
      layout: templateLayoutSchema,
    }),
  ),
  /** The company's default, else the every-company default, else null for the built-in Classic. */
  defaultTemplateId: z.string().nullable(),
});
export type PrintBundle = z.infer<typeof printBundleSchema>;
