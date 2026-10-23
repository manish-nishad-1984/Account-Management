CREATE TABLE "employee_salary_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"line_number" integer NOT NULL,
	CONSTRAINT "employee_salary_items_amount_positive" CHECK ("employee_salary_items"."amount" > 0),
	CONSTRAINT "employee_salary_items_kind" CHECK ("employee_salary_items"."kind" in ('addition', 'deduction'))
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mobile" text,
	"address" text,
	"company_id" uuid NOT NULL,
	"site_id" uuid,
	"join_date" date,
	"bank_name" text,
	"account_holder" text,
	"account_no" text,
	"ifsc_code" text,
	"basic_salary" numeric(18, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	CONSTRAINT "employees_basic_not_negative" CHECK ("employees"."basic_salary" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payout_list_salaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_list_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"salary_month" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"note" text,
	"paid_amount" numeric(18, 2),
	"line_number" integer NOT NULL,
	CONSTRAINT "payout_list_salaries_list_employee_month_key" UNIQUE("payout_list_id","employee_id","salary_month"),
	CONSTRAINT "payout_list_salaries_amount_positive" CHECK ("payout_list_salaries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "salary_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"salary_month" date NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid,
	"payment_date" timestamp with time zone NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"method" text,
	"reference_no" text,
	"source_payout_list_id" uuid,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	CONSTRAINT "salary_payments_amount_positive" CHECK ("salary_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "balance_sheet_rows" ADD COLUMN "salary" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_salary_items" ADD CONSTRAINT "employee_salary_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_list_salaries" ADD CONSTRAINT "payout_list_salaries_payout_list_id_payout_lists_id_fk" FOREIGN KEY ("payout_list_id") REFERENCES "public"."payout_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_list_salaries" ADD CONSTRAINT "payout_list_salaries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_source_payout_list_id_payout_lists_id_fk" FOREIGN KEY ("source_payout_list_id") REFERENCES "public"."payout_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_salary_items_employee_idx" ON "employee_salary_items" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employees_company_idx" ON "employees" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "payout_list_salaries_list_idx" ON "payout_list_salaries" USING btree ("payout_list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_payments_employee_month_key" ON "salary_payments" USING btree ("employee_id","salary_month") WHERE "salary_payments"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "salary_payments_site_idx" ON "salary_payments" USING btree ("site_id");--> statement-breakpoint
-- EMPLOYEE MASTER (client request, 23 Oct 2026): form row "Employee" (subject
-- `employee`, id 106), clear of 100-105 and the legacy ids.
INSERT INTO "forms" ("id", "form_group", "form_name", "controller", "order_id", "is_active")
VALUES (106, 'Masters', 'Employee', NULL, 106, true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Salaries are paid from the payout list, so the Employee master goes to whoever
-- holds the Payout form, flag for flag. A row without view is skipped.
INSERT INTO "user_form_permissions" ("user_id", "form_id", "is_view_allow", "is_add_allow", "is_edit_allow", "is_delete_allow", "is_approved")
SELECT p."user_id", 106, true, bool_or(p."is_add_allow"), bool_or(p."is_edit_allow"), bool_or(p."is_delete_allow"), false
FROM "user_form_permissions" p
JOIN "forms" f ON f."id" = p."form_id"
WHERE f."form_name" = 'Payout' AND f."is_active" AND p."is_view_allow"
GROUP BY p."user_id"
ON CONFLICT DO NOTHING;
