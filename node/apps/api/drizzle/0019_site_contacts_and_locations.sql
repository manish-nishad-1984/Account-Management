CREATE TABLE "site_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text,
	"phone" text,
	"line_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_location_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"address" text NOT NULL,
	"line_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "site_location_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "shipping_address" text;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "site_location_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "site_location_id" uuid;--> statement-breakpoint
ALTER TABLE "site_contacts" ADD CONSTRAINT "site_contacts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_location_addresses" ADD CONSTRAINT "site_location_addresses_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_locations" ADD CONSTRAINT "site_locations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_contacts_site_id_idx" ON "site_contacts" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "site_location_addresses_site_id_idx" ON "site_location_addresses" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "site_locations_site_id_idx" ON "site_locations" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_locations_site_name_key" ON "site_locations" USING btree ("site_id",lower("name")) WHERE "site_locations"."is_deleted" = false;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_site_location_id_site_locations_id_fk" FOREIGN KEY ("site_location_id") REFERENCES "public"."site_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_site_location_id_site_locations_id_fk" FOREIGN KEY ("site_location_id") REFERENCES "public"."site_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_site_location_id_site_locations_id_fk" FOREIGN KEY ("site_location_id") REFERENCES "public"."site_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- DATA, hand-written below this line (15 Sep 2026). Everything above was generated.
--
-- 1. Every site's existing contact becomes the first row of its contact list.
INSERT INTO "site_contacts" ("site_id", "name", "phone", "line_number")
SELECT "id", nullif(btrim("contact_person_name"), ''), nullif(btrim("contact_person_phone_no"), ''), 1
FROM "sites"
WHERE coalesce(btrim("contact_person_name"), '') <> ''
   OR coalesce(btrim("contact_person_phone_no"), '') <> '';
--> statement-breakpoint
-- 2. Site groups become site locations: one location per (group, member site),
--    named after the group. btrim with CR and LF, because four live group names
--    end in a carriage return and plain btrim removes only spaces.
INSERT INTO "site_locations" ("site_id", "name", "created_by", "created_at")
SELECT DISTINCT ON (m."site_id", lower(btrim(g."name", E' \t\r\n')))
       m."site_id", btrim(g."name", E' \t\r\n'), g."created_by", g."created_at"
FROM "site_groups" g
JOIN "site_group_sites" m ON m."group_id" = g."id"
WHERE g."is_deleted" = false
  AND btrim(g."name", E' \t\r\n') <> ''
ORDER BY m."site_id", lower(btrim(g."name", E' \t\r\n')), g."created_at";
--> statement-breakpoint
-- 3. A document can name a group its own site was never a member of, or a group
--    since deleted. It still gets a location of that name at its own site, so no
--    document loses the name it was raised with. Deleted groups give deleted
--    locations: kept for the document, not offered on new ones.
INSERT INTO "site_locations" ("site_id", "name", "is_deleted", "created_at")
SELECT DISTINCT ON (d."site_id", lower(btrim(g."name", E' \t\r\n')))
       d."site_id", btrim(g."name", E' \t\r\n'), g."is_deleted", g."created_at"
FROM (
  SELECT "site_id", "site_group_id" FROM "purchase_orders"
  UNION
  SELECT "site_id", "site_group_id" FROM "purchase_invoices"
  UNION
  SELECT "site_id", "site_group_id" FROM "payments"
) d
JOIN "site_groups" g ON g."id" = d."site_group_id"
WHERE d."site_id" IS NOT NULL
  AND btrim(g."name", E' \t\r\n') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "site_locations" l
    WHERE l."site_id" = d."site_id"
      AND lower(l."name") = lower(btrim(g."name", E' \t\r\n'))
  )
ORDER BY d."site_id", lower(btrim(g."name", E' \t\r\n')), g."is_deleted";
--> statement-breakpoint
-- 4. Point each document at the location of its group's name, at its own site.
UPDATE "purchase_orders" AS d
SET "site_location_id" = (
  SELECT l."id"
  FROM "site_locations" l
  JOIN "site_groups" g ON g."id" = d."site_group_id"
  WHERE l."site_id" = d."site_id"
    AND lower(l."name") = lower(btrim(g."name", E' \t\r\n'))
  ORDER BY l."is_deleted", l."created_at"
  LIMIT 1
)
WHERE d."site_group_id" IS NOT NULL AND d."site_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "purchase_invoices" AS d
SET "site_location_id" = (
  SELECT l."id"
  FROM "site_locations" l
  JOIN "site_groups" g ON g."id" = d."site_group_id"
  WHERE l."site_id" = d."site_id"
    AND lower(l."name") = lower(btrim(g."name", E' \t\r\n'))
  ORDER BY l."is_deleted", l."created_at"
  LIMIT 1
)
WHERE d."site_group_id" IS NOT NULL AND d."site_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "payments" AS d
SET "site_location_id" = (
  SELECT l."id"
  FROM "site_locations" l
  JOIN "site_groups" g ON g."id" = d."site_group_id"
  WHERE l."site_id" = d."site_id"
    AND lower(l."name") = lower(btrim(g."name", E' \t\r\n'))
  ORDER BY l."is_deleted", l."created_at"
  LIMIT 1
)
WHERE d."site_group_id" IS NOT NULL AND d."site_id" IS NOT NULL;
--> statement-breakpoint
-- 5. A live group's addresses are copied to every member site's location
--    address list, once per distinct address.
INSERT INTO "site_location_addresses" ("site_id", "address", "line_number")
SELECT x."site_id", x."address",
       (row_number() OVER (PARTITION BY x."site_id" ORDER BY x."address"))::int
FROM (
  SELECT DISTINCT m."site_id", btrim(a."address", E' \t\r\n') AS "address"
  FROM "site_group_addresses" a
  JOIN "site_groups" g ON g."id" = a."group_id" AND g."is_deleted" = false
  JOIN "site_group_sites" m ON m."group_id" = g."id"
  WHERE btrim(a."address", E' \t\r\n') <> ''
) x;
