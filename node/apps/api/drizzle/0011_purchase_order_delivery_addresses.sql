CREATE TABLE "purchase_order_delivery_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"address" text NOT NULL,
	"quantity" numeric(18, 2) NOT NULL,
	"line_number" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_order_delivery_addresses" ADD CONSTRAINT "purchase_order_delivery_addresses_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_delivery_addresses_po_id_idx" ON "purchase_order_delivery_addresses" USING btree ("purchase_order_id");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "terms_template" text;
