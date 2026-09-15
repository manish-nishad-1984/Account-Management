CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_type" text NOT NULL,
	"company_id" uuid,
	"name" text NOT NULL,
	"based_on" text DEFAULT 'custom' NOT NULL,
	"layout" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_templates_type_idx" ON "document_templates" USING btree ("document_type");--> statement-breakpoint
CREATE UNIQUE INDEX "document_templates_one_default_key" ON "document_templates" USING btree ("document_type",coalesce("company_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "document_templates"."is_default" and not "document_templates"."is_deleted";--> statement-breakpoint
-- The right to manage templates. A new form row, because permissions here are
-- rows in `forms` and the subject is the slug of the name: "Document Template"
-- is `document-template`. Id 100 stays clear of the ids the legacy table uses
-- (1-29 in production) and of the dev seed's (1-15).
INSERT INTO "forms" ("id", "form_group", "form_name", "controller", "order_id", "is_active")
VALUES (100, 'Settings', 'Document Template', NULL, 100, true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Granted to whoever may already edit companies: templates carry the company's
-- name, address and bank details onto paper. Anyone else is granted it on the
-- Permissions screen, like any other form.
INSERT INTO "user_form_permissions" ("user_id", "form_id", "is_view_allow", "is_add_allow", "is_edit_allow", "is_delete_allow", "is_approved")
SELECT p."user_id", 100, true, true, true, true, false
FROM "user_form_permissions" p
JOIN "forms" f ON f."id" = p."form_id"
WHERE f."form_name" = 'Company' AND f."is_active" AND p."is_edit_allow"
ON CONFLICT DO NOTHING;
