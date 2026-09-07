ALTER TABLE "inward_challan_documents" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "inward_challan_documents" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "inward_challan_documents" ADD COLUMN "uploaded_by" uuid;