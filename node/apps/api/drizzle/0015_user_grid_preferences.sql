CREATE TABLE "user_grid_preferences" (
	"user_id" uuid NOT NULL,
	"grid_key" text NOT NULL,
	"columns" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_grid_preferences_user_id_grid_key_pk" PRIMARY KEY("user_id","grid_key")
);
--> statement-breakpoint
ALTER TABLE "user_grid_preferences" ADD CONSTRAINT "user_grid_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;