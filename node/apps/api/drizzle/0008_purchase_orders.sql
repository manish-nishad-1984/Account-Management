CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_no" text NOT NULL,
	"site_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"document_date" timestamp with time zone,
	"site_group_id" uuid,
	"delivery_date" timestamp with time zone,
	"delivery_immediate" boolean DEFAULT false NOT NULL,
	"terms" text,
	"description" text,
	"billing_address" text,
	"group_address" text,
	"buyers_purchase_no" text,
	"contact_name" text,
	"contact_number" text,
	"other_contact_name" text,
	"other_contact_number" text,
	"dispatch_by" text,
	"payment_terms" text,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_gst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_discount" numeric(18, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"item_id" uuid,
	"item_name" text,
	"item_description" text,
	"unit_id" integer NOT NULL,
	"quantity" numeric(18, 2) NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"gst_percent" numeric(5, 2),
	"gst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(18, 2),
	"line_number" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_site_group_id_site_groups_id_fk" FOREIGN KEY ("site_group_id") REFERENCES "public"."site_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_orders_site_id_idx" ON "purchase_orders" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_company_id_idx" ON "purchase_orders" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_is_approved_idx" ON "purchase_orders" USING btree ("is_approved");--> statement-breakpoint
CREATE INDEX "purchase_orders_is_active_idx" ON "purchase_orders" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "purchase_orders_created_at_idx" ON "purchase_orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_items_item_id_idx" ON "purchase_order_items" USING btree ("item_id");--> statement-breakpoint
ALTER TABLE "document_counters" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_counters" DROP CONSTRAINT "document_counters_document_type_financial_year_pk";--> statement-breakpoint
CREATE UNIQUE INDEX "document_counters_global_uq" ON "document_counters" USING btree ("document_type","financial_year") WHERE "document_counters"."company_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "document_counters_company_uq" ON "document_counters" USING btree ("document_type","financial_year","company_id") WHERE "document_counters"."company_id" is not null;
