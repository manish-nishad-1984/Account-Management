CREATE TABLE "item_price_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"source" text NOT NULL,
	"old_price" numeric(18, 2),
	"new_price" numeric(18, 2) NOT NULL,
	"old_gst_percent" numeric(5, 2),
	"new_gst_percent" numeric(5, 2),
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_price_changes" ADD CONSTRAINT "item_price_changes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_price_changes_item_changed_idx" ON "item_price_changes" USING btree ("item_id","changed_at");--> statement-breakpoint
-- The price every existing item already has, as the first row of its history.
-- Marked `baseline`, not `created`: nothing recorded when these prices were set.
INSERT INTO "item_price_changes" ("item_id", "source", "old_price", "new_price", "old_gst_percent", "new_gst_percent", "changed_by", "changed_at")
SELECT "id", 'baseline', NULL, "price_per_unit", NULL, "gst_percent", NULL, now()
FROM "items"
WHERE "is_deleted" = false;
