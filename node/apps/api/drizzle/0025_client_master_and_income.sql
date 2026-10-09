CREATE TABLE "client_income_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"income_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"remark" text,
	"line_number" integer NOT NULL,
	CONSTRAINT "client_income_adjustments_kind" CHECK ("client_income_adjustments"."kind" in ('addition', 'deduction')),
	CONSTRAINT "client_income_adjustments_amount_positive" CHECK ("client_income_adjustments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "client_incomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"income_date" date NOT NULL,
	"site_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"additional_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"deduction_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"method" text,
	"reference_no" text,
	"note" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	CONSTRAINT "client_incomes_amount_positive" CHECK ("client_incomes"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "client_sites" (
	"client_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	CONSTRAINT "client_sites_client_id_site_id_pk" PRIMARY KEY("client_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mobile" text,
	"email" text,
	"gst_no" text,
	"pan_no" text,
	"address" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "client_income_adjustments" ADD CONSTRAINT "client_income_adjustments_income_id_client_incomes_id_fk" FOREIGN KEY ("income_id") REFERENCES "public"."client_incomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_incomes" ADD CONSTRAINT "client_incomes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_incomes" ADD CONSTRAINT "client_incomes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_incomes" ADD CONSTRAINT "client_incomes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_sites" ADD CONSTRAINT "client_sites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_sites" ADD CONSTRAINT "client_sites_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_income_adjustments_income_idx" ON "client_income_adjustments" USING btree ("income_id");--> statement-breakpoint
CREATE INDEX "client_incomes_site_idx" ON "client_incomes" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "client_incomes_date_idx" ON "client_incomes" USING btree ("income_date" desc) WHERE "client_incomes"."is_deleted" = false;--> statement-breakpoint
-- CLIENT MASTER and INCOME (client request, 9 Oct 2026): who pays us for a project,
-- and the money received. Two form rows: "Client" (subject `client`, id 103) and
-- "Income" (subject `income`, id 104), clear of 100-102 and the legacy ids.
INSERT INTO "forms" ("id", "form_group", "form_name", "controller", "order_id", "is_active")
VALUES (103, 'Masters', 'Client', NULL, 103, true), (104, 'Reports', 'Income', NULL, 104, true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Client: to whoever may already edit suppliers, the nearest existing master.
INSERT INTO "user_form_permissions" ("user_id", "form_id", "is_view_allow", "is_add_allow", "is_edit_allow", "is_delete_allow", "is_approved")
SELECT DISTINCT p."user_id", 103, true, true, true, true, false
FROM "user_form_permissions" p
JOIN "forms" f ON f."id" = p."form_id"
WHERE f."form_name" = 'Supplier' AND f."is_active" AND p."is_edit_allow"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Income: money figures the boss reports on, so it goes to whoever holds Reports &
-- Payments, flag for flag (as the Payout form did). A row without view is skipped.
INSERT INTO "user_form_permissions" ("user_id", "form_id", "is_view_allow", "is_add_allow", "is_edit_allow", "is_delete_allow", "is_approved")
SELECT p."user_id", 104, true, bool_or(p."is_add_allow"), bool_or(p."is_edit_allow"), bool_or(p."is_delete_allow"), false
FROM "user_form_permissions" p
JOIN "forms" f ON f."id" = p."form_id"
WHERE f."form_name" = 'Reports & Payments' AND f."is_active" AND p."is_view_allow"
GROUP BY p."user_id"
ON CONFLICT DO NOTHING;
