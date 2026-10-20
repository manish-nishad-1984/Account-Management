CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"label" text NOT NULL,
	"facts" jsonb NOT NULL,
	"changes" jsonb,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity","entity_id","at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_action_idx" ON "audit_events" USING btree ("entity","action","at");