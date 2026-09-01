CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" integer PRIMARY KEY NOT NULL,
	"form_group" text,
	"form_name" text NOT NULL,
	"controller" text,
	"action" text,
	"order_id" integer,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"company_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_companies" (
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	CONSTRAINT "user_companies_user_id_company_id_pk" PRIMARY KEY("user_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "user_form_permissions" (
	"user_id" uuid NOT NULL,
	"form_id" integer NOT NULL,
	"is_view_allow" boolean DEFAULT false NOT NULL,
	"is_add_allow" boolean DEFAULT false NOT NULL,
	"is_edit_allow" boolean DEFAULT false NOT NULL,
	"is_delete_allow" boolean DEFAULT false NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_form_permissions_user_id_form_id_pk" PRIMARY KEY("user_id","form_id")
);
--> statement-breakpoint
CREATE TABLE "user_sites" (
	"user_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	CONSTRAINT "user_sites_user_id_site_id_pk" PRIMARY KEY("user_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone_no" text NOT NULL,
	"user_name" text NOT NULL,
	"password" text NOT NULL,
	"password_is_legacy" boolean DEFAULT false NOT NULL,
	"password_migrated_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_form_permissions" ADD CONSTRAINT "user_form_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_form_permissions" ADD CONSTRAINT "user_form_permissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sites" ADD CONSTRAINT "user_sites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sites" ADD CONSTRAINT "user_sites_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_user_name_lower_key" ON "users" USING btree (lower("user_name"));--> statement-breakpoint
CREATE INDEX "users_is_active_idx" ON "users" USING btree ("is_active");