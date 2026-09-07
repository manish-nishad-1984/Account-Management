CREATE TABLE "document_counters" (
	"document_type" text NOT NULL,
	"financial_year" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_counters_document_type_financial_year_pk" PRIMARY KEY("document_type","financial_year")
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pr_no" text NOT NULL,
	"site_id" uuid NOT NULL,
	"item_id" uuid,
	"item_name" text,
	"item_description" text,
	"unit_id" integer NOT NULL,
	"quantity" numeric(18, 2) NOT NULL,
	"document_date" timestamp with time zone,
	"site_address_id" integer,
	"site_address" text,
	"is_approved" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_requests_pr_no_key" ON "purchase_requests" USING btree (upper("pr_no")) WHERE "purchase_requests"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "purchase_requests_site_id_idx" ON "purchase_requests" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "purchase_requests_item_id_idx" ON "purchase_requests" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "purchase_requests_is_approved_idx" ON "purchase_requests" USING btree ("is_approved");