CREATE TABLE "inward_challan_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challan_id" uuid NOT NULL,
	"document_name" text NOT NULL,
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inward_challans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"item_name" text,
	"supplier_id" uuid,
	"unit_id" integer NOT NULL,
	"quantity" numeric(18, 2) NOT NULL,
	"invoice_no" text,
	"document_date" timestamp with time zone,
	"vehicle_number" text,
	"receiver_name" text,
	"is_approved" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inward_challan_documents" ADD CONSTRAINT "inward_challan_documents_challan_id_inward_challans_id_fk" FOREIGN KEY ("challan_id") REFERENCES "public"."inward_challans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inward_challans" ADD CONSTRAINT "inward_challans_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inward_challans" ADD CONSTRAINT "inward_challans_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inward_challans" ADD CONSTRAINT "inward_challans_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inward_challans" ADD CONSTRAINT "inward_challans_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inward_challan_documents_challan_id_idx" ON "inward_challan_documents" USING btree ("challan_id");--> statement-breakpoint
CREATE INDEX "inward_challans_site_id_idx" ON "inward_challans" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "inward_challans_supplier_id_idx" ON "inward_challans" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "inward_challans_item_id_idx" ON "inward_challans" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "inward_challans_is_approved_idx" ON "inward_challans" USING btree ("is_approved");--> statement-breakpoint
CREATE INDEX "inward_challans_document_date_idx" ON "inward_challans" USING btree ("document_date");