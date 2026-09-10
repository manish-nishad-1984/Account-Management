DROP INDEX "suppliers_gst_no_key";--> statement-breakpoint
CREATE INDEX "suppliers_gst_no_key" ON "suppliers" USING btree (upper("gst_no"));