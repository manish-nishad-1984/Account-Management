CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"document_kind" text NOT NULL,
	"document_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_payment_document_key" UNIQUE("payment_id","document_kind","document_id"),
	CONSTRAINT "payment_allocations_amount_positive" CHECK ("payment_allocations"."amount" > 0),
	CONSTRAINT "payment_allocations_kind" CHECK ("payment_allocations"."document_kind" in ('invoice', 'opening_balance'))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "source_payout_list_id" uuid;--> statement-breakpoint
ALTER TABLE "payout_list_invoices" ADD COLUMN "paid_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "payout_list_lines" ADD COLUMN "extra_paid" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "payout_lists" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_lists" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_lists" ADD COLUMN "confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_allocations_payment_idx" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_document_idx" ON "payment_allocations" USING btree ("document_kind","document_id");--> statement-breakpoint
CREATE INDEX "payments_source_payout_list_idx" ON "payments" USING btree ("source_payout_list_id");--> statement-breakpoint
-- CONFIRM PAYOUT is the existing "approve" flag on the Payout form (form id 102,
-- migration 0022 left it unused: a list had no approval). Confirming a list creates
-- real payments, so it is its own right. Granted here to whoever may already EDIT
-- payout lists, so the screen is usable straight away; an administrator can untick
-- it per user.
UPDATE "user_form_permissions" SET "is_approved" = true WHERE "form_id" = 102 AND "is_edit_allow" = true;
