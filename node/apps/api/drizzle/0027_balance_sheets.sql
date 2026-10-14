CREATE TABLE "balance_sheet_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"balance_sheet_id" uuid NOT NULL,
	"site_id" uuid,
	"site_name" text NOT NULL,
	"income" numeric(18, 2) NOT NULL,
	"billed" numeric(18, 2) NOT NULL,
	"paid" numeric(18, 2) NOT NULL,
	"line_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balance_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"company_id" uuid,
	"income_from" date,
	"income_to" date,
	"invoice_from" date,
	"invoice_to" date,
	"note" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "balance_sheet_rows" ADD CONSTRAINT "balance_sheet_rows_balance_sheet_id_balance_sheets_id_fk" FOREIGN KEY ("balance_sheet_id") REFERENCES "public"."balance_sheets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_sheet_rows" ADD CONSTRAINT "balance_sheet_rows_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_sheets" ADD CONSTRAINT "balance_sheets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_sheet_rows_sheet_id_idx" ON "balance_sheet_rows" USING btree ("balance_sheet_id");--> statement-breakpoint
CREATE INDEX "balance_sheets_created_at_idx" ON "balance_sheets" USING btree ("created_at" desc) WHERE "balance_sheets"."is_deleted" = false;--> statement-breakpoint
-- The right to keep balance sheets: form row "Balance Sheets", so the subject is
-- `balance-sheets`. Id 105, after Income (104).
INSERT INTO "forms" ("id", "form_group", "form_name", "controller", "order_id", "is_active")
VALUES (105, 'Reports', 'Balance Sheets', NULL, 105, true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Granted to whoever already holds Income, flag for flag: a sheet adds up income
-- and expense, and the report it comes from is already behind Income. A row
-- without view is skipped. Approve is never copied; a sheet has no approval.
INSERT INTO "user_form_permissions" ("user_id", "form_id", "is_view_allow", "is_add_allow", "is_edit_allow", "is_delete_allow", "is_approved")
SELECT p."user_id", 105, true, bool_or(p."is_add_allow"), bool_or(p."is_edit_allow"), bool_or(p."is_delete_allow"), false
FROM "user_form_permissions" p
JOIN "forms" f ON f."id" = p."form_id"
WHERE f."form_name" = 'Income' AND f."is_active" AND p."is_view_allow"
GROUP BY p."user_id"
ON CONFLICT DO NOTHING;
