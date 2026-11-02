ALTER TABLE "item_price_changes" ALTER COLUMN "old_price" SET DATA TYPE numeric(18, 3);--> statement-breakpoint
ALTER TABLE "item_price_changes" ALTER COLUMN "new_price" SET DATA TYPE numeric(18, 3);--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "price_per_unit" SET DATA TYPE numeric(18, 3);--> statement-breakpoint
ALTER TABLE "purchase_order_items" ALTER COLUMN "unit_price" SET DATA TYPE numeric(18, 3);--> statement-breakpoint
ALTER TABLE "purchase_invoice_items" ALTER COLUMN "unit_price" SET DATA TYPE numeric(18, 3);--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ALTER COLUMN "unit_price" SET DATA TYPE numeric(18, 3);