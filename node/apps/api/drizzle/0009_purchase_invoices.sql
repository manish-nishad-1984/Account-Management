CREATE TABLE "purchase_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_invoice_no" text,
	"invoice_no" text,
	"invoice_type" text DEFAULT 'Purchase' NOT NULL,
	"site_id" uuid,
	"supplier_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"site_group_id" uuid,
	"document_date" timestamp with time zone,
	"challan_no" text,
	"lr_no" text,
	"vehicle_no" text,
	"dispatch_by" text,
	"payment_terms" text,
	"description" text,
	"contact_name" text,
	"contact_number" text,
	"shipping_address" text,
	"group_address" text,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_gst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tds" numeric(18, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"payment_status" text,
	"is_paid_out" boolean DEFAULT false NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "purchase_invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_invoice_id" uuid NOT NULL,
	"item_id" uuid,
	"item_name" text,
	"item_description" text,
	"unit_id" integer NOT NULL,
	"quantity" numeric(18, 2) NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"discount_per_unit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gst_percent" numeric(5, 2),
	"gst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_number" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_site_group_id_site_groups_id_fk" FOREIGN KEY ("site_group_id") REFERENCES "public"."site_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_invoices_site_id_idx" ON "purchase_invoices" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_supplier_id_idx" ON "purchase_invoices" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_company_id_idx" ON "purchase_invoices" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_purchase_order_id_idx" ON "purchase_invoices" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_is_approved_idx" ON "purchase_invoices" USING btree ("is_approved");--> statement-breakpoint
CREATE INDEX "purchase_invoices_document_date_idx" ON "purchase_invoices" USING btree ("document_date");--> statement-breakpoint
CREATE INDEX "purchase_invoices_created_at_idx" ON "purchase_invoices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "purchase_invoice_items_purchase_invoice_id_idx" ON "purchase_invoice_items" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "purchase_invoice_items_item_id_idx" ON "purchase_invoice_items" USING btree ("item_id");
