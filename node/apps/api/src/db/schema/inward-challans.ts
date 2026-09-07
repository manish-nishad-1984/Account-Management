import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sites } from "./users";
import { items, suppliers, units } from "./masters";

/**
 * Inward challans — goods arriving from a supplier, against an invoice.
 *
 * `ItemInword` in SQL Server, reached through `/ItemInWord/ItemInWord`. THREE
 * spellings are live in the source: the controller is `ItemInWord`, the entity
 * is `ItemInword`, the key is `InwordId` and the request field is `InwardId`.
 * This settles on `inward` throughout and maps at the ETL boundary.
 *
 * TWO REPOSITORIES EXIST FOR THIS TABLE. `ItemInwardRepository/ItemInwardRepo.cs`
 * (447 lines) is the one registered in `Program.cs`;
 * `ItemInWordRepository/ItemInWordRepo.cs` (450 lines) is a near-identical copy
 * that nothing resolves. They have DIFFERENT behaviour — see `supplierId` below —
 * so anyone reading the dead one to understand production is reading the wrong
 * file.
 */
export const inwardChallans = pgTable(
  "inward_challans",
  {
    /** `InwordId` in the source. */
    id: uuid("id").primaryKey().defaultRandom(),

    /** NOT NULL in the source and here. The list INNER JOINs it. */
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),

    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),

    /**
     * `Item` — the item's name as it was when the row was keyed. Kept because
     * the source stores it, read by nothing: both the list and the detail take
     * the name from the master, as `GetItemInWordList` does.
     */
    itemName: text("item_name"),

    /**
     * NULLABLE, and the source's live create path DROPS IT.
     *
     * `AddItemInWordDetails` — in the registered repository — builds the entity
     * without `SupplierId` and without `InvoiceNo`, though both are displayed in
     * the list and the detail pane. `InsertMultipleItemInWordDetails`, in the
     * same file, sets both. So the same table has one create path that records
     * the supplier and one that silently discards it, and which a challan gets
     * depends on which endpoint the screen happened to call.
     *
     * The single-row update has the same split: `UpdateItemInWordDetails` omits
     * `SiteId`, `SupplierId` and `InvoiceNo`, so editing a challan through it
     * clears nothing but preserves nothing either — those three keep whatever
     * they had while every other field moves. `UpdatetMultipleItemInWordDetails`
     * writes all of them.
     *
     * There is ONE path here, and it writes every field it is given.
     */
    supplierId: uuid("supplier_id").references(() => suppliers.id),

    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id),

    quantity: numeric("quantity", { precision: 18, scale: 2 }).notNull(),

    /**
     * FREE TEXT, not a number. The captures show `922`, `1` and `253-1`.
     * A supplier's invoice number is the supplier's to format.
     */
    invoiceNo: text("invoice_no"),

    /**
     * `Date` — the date on the challan.
     *
     * `AddItemInWordDetails` sets this to `DateTime.Now` and ignores the date the
     * user typed, so a challan entered a week late is dated today.
     * `InsertMultipleItemInWordDetails` uses the supplied date. Another split
     * between the two create paths; the date given is the date stored here.
     */
    documentDate: timestamp("document_date", { withTimezone: true }),

    /**
     * Upper-cased by the source on create — `VehicleNumber.ToUpper()` — which
     * throws a NullReferenceException when the field is left blank, and the
     * column is nullable and the form does not require it. Normalised here only
     * when a value is actually present.
     */
    vehicleNumber: text("vehicle_number"),

    /**
     * FREE TEXT, deliberately not normalised. The captured value is
     * `SURESHBHAI-CC-2000X2 7TH` — a person, a group code and what looks like a
     * batch reference in one field. Splitting it would be inventing a structure
     * the data does not have.
     */
    receiverName: text("receiver_name"),

    isApproved: boolean("is_approved").notNull().default(false),

    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("inward_challans_site_id_idx").on(table.siteId),
    index("inward_challans_supplier_id_idx").on(table.supplierId),
    index("inward_challans_item_id_idx").on(table.itemId),
    index("inward_challans_is_approved_idx").on(table.isApproved),
    /** The list is ordered by this and the filters narrow on the date. */
    index("inward_challans_document_date_idx").on(table.documentDate),
  ],
);

/**
 * Attachments on a challan. `ItemInWordDocument` in the source.
 *
 * THE SOURCE STORES THIS TWICE. `ItemInword.DocumentName` holds a
 * SEMICOLON-JOINED string of file names AND `ItemInWordDocument` holds one row
 * per file. `UpdatetMultipleItemInWordDetails` reconciles them by hand with
 * `UpdateInWordDetails.DocumentName.Split(';')`, which throws a
 * NullReferenceException whenever the parent column is null — which it is on the
 * captured row, whose DocumentName is empty.
 *
 * One representation here: rows in this table. The parent's joined string is not
 * carried, and the ETL explodes it into rows if the child table is ever missing
 * one.
 *
 * THERE ARE BYTES NOW. `storage_key` is the location in whatever `DocumentStorage`
 * driver is configured — the local disk today, object storage the day someone
 * decides to. It stays NULLABLE, because every row the ETL carries has a file
 * name and no location: the source's own table records nothing else, and the
 * files are on the old web server. A row with a null key is a record that a
 * document existed, which is worth keeping and is not worth pretending is
 * downloadable.
 */
export const inwardChallanDocuments = pgTable(
  "inward_challan_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    challanId: uuid("challan_id")
      .notNull()
      .references(() => inwardChallans.id, { onDelete: "cascade" }),

    /**
     * The name the file had when it was uploaded — DISPLAY ONLY, and never part
     * of a path.
     *
     * The source built its destination out of this exact value
     * (`ItemInWordController.cs:191`), which is finding H-10: a browser controls
     * `IFormFile.FileName`, it may contain `..` and separators, and
     * `Path.Combine` was given it unsanitised. Here the storage key is generated
     * server-side and this column is data.
     */
    documentName: text("document_name").notNull(),

    /**
     * Where the bytes are, in the configured storage driver. NULL on every row
     * the ETL carries: the source records no location at all.
     */
    storageKey: text("storage_key"),

    /**
     * What the file will be SERVED as, decided from the extension against the
     * allowlist in `contracts/attachments.ts` — not copied from the upload's own
     * `Content-Type` header, which the client chooses and can lie about.
     */
    contentType: text("content_type"),

    /** Bytes actually written, so the UI need not fetch a file to size it. */
    sizeBytes: integer("size_bytes"),

    /** Null for ETL rows: the source records no uploader for a document. */
    uploadedBy: uuid("uploaded_by"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("inward_challan_documents_challan_id_idx").on(table.challanId)],
);
