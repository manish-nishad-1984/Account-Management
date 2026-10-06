CREATE TABLE "payout_list_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_line_id" uuid NOT NULL,
	"source" text NOT NULL,
	"document_id" text NOT NULL,
	"display_no" text NOT NULL,
	"document_date" date,
	"site_name" text,
	"amount" numeric(18, 2) NOT NULL,
	"pending_at_save" numeric(18, 2),
	"line_number" integer NOT NULL,
	CONSTRAINT "payout_list_invoices_line_doc_key" UNIQUE("payout_line_id","source","document_id"),
	CONSTRAINT "payout_list_invoices_amount_positive" CHECK ("payout_list_invoices"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "payout_list_invoices" ADD CONSTRAINT "payout_list_invoices_payout_line_id_payout_list_lines_id_fk" FOREIGN KEY ("payout_line_id") REFERENCES "public"."payout_list_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_list_invoices_line_idx" ON "payout_list_invoices" USING btree ("payout_line_id");