CREATE TABLE "inventory_inward" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"item_id" uuid NOT NULL,
	"item_name" text,
	"unit_id" integer NOT NULL,
	"quantity" numeric(18, 2) NOT NULL,
	"document_date" timestamp with time zone,
	"details" text,
	"is_approved" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inventory_inward" ADD CONSTRAINT "inventory_inward_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_inward" ADD CONSTRAINT "inventory_inward_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_inward" ADD CONSTRAINT "inventory_inward_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_inward_site_id_idx" ON "inventory_inward" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "inventory_inward_item_id_idx" ON "inventory_inward" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "inventory_inward_is_approved_idx" ON "inventory_inward" USING btree ("is_approved");