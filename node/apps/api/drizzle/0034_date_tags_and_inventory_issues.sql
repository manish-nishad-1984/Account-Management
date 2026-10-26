CREATE TABLE "agency_persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mobile" text,
	"photo_key" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"source" text NOT NULL,
	"inventory_item_id" uuid,
	"item_id" uuid,
	"item_name" text NOT NULL,
	"unit_name" text,
	"quantity" numeric(18, 2) NOT NULL,
	"returnable" boolean NOT NULL,
	"agency_id" uuid NOT NULL,
	"agency_contact_id" uuid,
	"person_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"returned_quantity" numeric(18, 2),
	"returned_at" timestamp with time zone,
	"returned_by" uuid,
	"return_note" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	CONSTRAINT "inventory_issues_source" CHECK ("inventory_issues"."source" in ('inventory', 'purchase')),
	CONSTRAINT "inventory_issues_item_of_source" CHECK (("inventory_issues"."source" = 'inventory' and "inventory_issues"."inventory_item_id" is not null) or ("inventory_issues"."source" = 'purchase' and "inventory_issues"."item_id" is not null)),
	CONSTRAINT "inventory_issues_quantity_positive" CHECK ("inventory_issues"."quantity" > 0),
	CONSTRAINT "inventory_issues_returned_within" CHECK ("inventory_issues"."returned_quantity" is null or ("inventory_issues"."returned_quantity" >= 0 and "inventory_issues"."returned_quantity" <= "inventory_issues"."quantity"))
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'Nos' NOT NULL,
	"photo_key" text,
	"note" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "export_date_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"from_date" date,
	"to_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_inward" ALTER COLUMN "item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_inward" ALTER COLUMN "unit_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_inward" ADD COLUMN "inventory_item_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_inward" ADD COLUMN "photo_key" text;--> statement-breakpoint
ALTER TABLE "agency_persons" ADD CONSTRAINT "agency_persons_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_issues" ADD CONSTRAINT "inventory_issues_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_issues" ADD CONSTRAINT "inventory_issues_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_issues" ADD CONSTRAINT "inventory_issues_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_issues" ADD CONSTRAINT "inventory_issues_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_issues" ADD CONSTRAINT "inventory_issues_agency_contact_id_agency_contacts_id_fk" FOREIGN KEY ("agency_contact_id") REFERENCES "public"."agency_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_issues" ADD CONSTRAINT "inventory_issues_person_id_agency_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."agency_persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_date_tags" ADD CONSTRAINT "export_date_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_persons_agency_idx" ON "agency_persons" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "inventory_issues_site_idx" ON "inventory_issues" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "inventory_issues_inventory_item_idx" ON "inventory_issues" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE INDEX "inventory_issues_item_idx" ON "inventory_issues" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "inventory_issues_out_idx" ON "inventory_issues" USING btree ("issued_at") WHERE "inventory_issues"."is_deleted" = false and "inventory_issues"."returnable" = true and "inventory_issues"."returned_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_name_key" ON "inventory_items" USING btree (lower("name")) WHERE "inventory_items"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "export_date_tags_user_name_key" ON "export_date_tags" USING btree ("user_id",lower("name"));--> statement-breakpoint
ALTER TABLE "inventory_inward" ADD CONSTRAINT "inventory_inward_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_inward_inventory_item_idx" ON "inventory_inward" USING btree ("inventory_item_id");--> statement-breakpoint
ALTER TABLE "inventory_inward" ADD CONSTRAINT "inventory_inward_item_present" CHECK ("inventory_inward"."item_id" is not null or "inventory_inward"."inventory_item_id" is not null);