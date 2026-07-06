DROP INDEX "live_comments_shop_external_comment_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "customers_shop_tiktok_username_unique" ON "customers" USING btree ("shop_id","tiktok_username");--> statement-breakpoint
CREATE UNIQUE INDEX "live_comments_session_external_comment_id_unique" ON "live_comments" USING btree ("live_session_id","external_comment_id");--> statement-breakpoint
CREATE INDEX "live_sessions_shop_id_created_at_idx" ON "live_sessions" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tiktok_channels_shop_username_unique" ON "shop_tiktok_channels" USING btree ("shop_id","tiktok_username");