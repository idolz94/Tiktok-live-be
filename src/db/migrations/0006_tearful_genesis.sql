CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_comments" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "live_comments" ADD COLUMN "is_question" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "live_comments" ADD COLUMN "matched_product_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "spx_user_id" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "spx_user_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "facebook_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tiktok_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "youtube_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_logs_target_idx" ON "admin_audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_admin_created_at_idx" ON "admin_audit_logs" USING btree ("admin_user_id","created_at");--> statement-breakpoint
ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;