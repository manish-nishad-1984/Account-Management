CREATE TABLE "site_group_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"address" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_group_sites" (
	"group_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	CONSTRAINT "site_group_sites_group_id_site_id_pk" PRIMARY KEY("group_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "site_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_prefix" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "gst_no" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "pan_no" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "city_id" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "state_id" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "country_id" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "pincode" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "bank_branch" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "account_no" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "ifsc_code" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "contact_person_name" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "contact_person_phone_no" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "city_id" integer;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "state_id" integer;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "country_id" integer;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "pincode" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "shipping_address" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "shipping_area" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "shipping_city_id" integer;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "shipping_state_id" integer;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "shipping_country_id" integer;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "shipping_pincode" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_group_addresses" ADD CONSTRAINT "site_group_addresses_group_id_site_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."site_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_group_sites" ADD CONSTRAINT "site_group_sites_group_id_site_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."site_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_group_sites" ADD CONSTRAINT "site_group_sites_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_group_addresses_group_id_idx" ON "site_group_addresses" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "site_group_sites_site_id_idx" ON "site_group_sites" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_groups_name_lower_key" ON "site_groups" USING btree (lower("name")) WHERE "site_groups"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_gst_no_key" ON "companies" USING btree (upper("gst_no")) WHERE "companies"."gst_no" is not null and "companies"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "sites_is_active_idx" ON "sites" USING btree ("is_active");