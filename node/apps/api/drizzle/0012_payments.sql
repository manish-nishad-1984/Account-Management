CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" text NOT NULL,
	"kind" text DEFAULT 'payment' NOT NULL,
	"party_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid,
	"site_group_id" uuid,
	"payment_date" timestamp with time zone,
	"amount" numeric(18, 2) NOT NULL,
	"description" text,
	"method" text,
	"reference_no" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_id_suppliers_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_site_group_id_site_groups_id_fk" FOREIGN KEY ("site_group_id") REFERENCES "public"."site_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_party_id_idx" ON "payments" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "payments_company_id_idx" ON "payments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "payments_site_id_idx" ON "payments" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "payments_direction_idx" ON "payments" USING btree ("direction");--> statement-breakpoint
CREATE INDEX "payments_payment_date_idx" ON "payments" USING btree ("payment_date");--> statement-breakpoint
CREATE INDEX "payments_created_at_idx" ON "payments" USING btree ("created_at");