import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { TemplateLayout } from "@accountmanagement/contracts";
import { companies } from "./users";

/**
 * How a printed document looks — see `document-templates.ts` in the contracts
 * package for the layout itself.
 *
 * NEW, with no source table. Nothing in the .NET schema stores a print layout;
 * its print pages are fixed Razor views.
 */
export const documentTemplates = pgTable(
  "document_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** `sales-invoice`, `purchase-invoice`. Text, so a new type is not a migration. */
    documentType: text("document_type").notNull(),

    /**
     * NULL MEANS EVERY COMPANY. A company's own default wins over an
     * every-company default when its documents are printed.
     */
    companyId: uuid("company_id").references(() => companies.id),

    name: text("name").notNull(),

    /** The starter layout it was made from — `classic`, `compact` — or `custom`. */
    basedOn: text("based_on").notNull().default("custom"),

    /**
     * The whole layout as one document. It is read and written whole, never
     * queried inside, and validated against `templateLayoutSchema` on the way in.
     */
    layout: jsonb("layout").$type<TemplateLayout>().notNull(),

    isDefault: boolean("is_default").notNull().default(false),

    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("document_templates_type_idx").on(table.documentType),
    /**
     * ONE DEFAULT PER DOCUMENT TYPE PER COMPANY, with "every company" counted as
     * a company of its own. The repository clears the old default in the same
     * transaction as it sets the new one; this is what stops two requests racing
     * into two defaults.
     *
     * `coalesce` because a unique index treats NULLs as distinct, so without it
     * any number of every-company defaults would be allowed.
     */
    uniqueIndex("document_templates_one_default_key")
      .on(
        table.documentType,
        sql`coalesce(${table.companyId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.isDefault} and not ${table.isDeleted}`),
  ],
);
