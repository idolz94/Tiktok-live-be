CREATE TABLE IF NOT EXISTS "buying_intent_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"live_session_id" uuid NOT NULL,
	"tiktok_username" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"intent" text DEFAULT 'buy' NOT NULL,
	"priority_level" text DEFAULT 'high' NOT NULL,
	"final_score" real DEFAULT 0,
	"comment_count" integer DEFAULT 1,
	"latest_comment_id" uuid,
	"latest_comment_text" text,
	"latest_comment_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_comments" ADD COLUMN IF NOT EXISTS "can_suggest_order" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "live_comments" ADD COLUMN IF NOT EXISTS "can_create_draft_order" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "live_comments" ADD COLUMN IF NOT EXISTS "is_potential_buyer" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "live_comments" ADD COLUMN IF NOT EXISTS "matched_reasons" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "live_comments" ADD COLUMN IF NOT EXISTS "rule_version" text DEFAULT 'comment-rules-v1';--> statement-breakpoint
ALTER TABLE "live_comments" ADD COLUMN IF NOT EXISTS "topic" text;--> statement-breakpoint
ALTER TABLE "live_comments" ADD COLUMN IF NOT EXISTS "confidence" real;--> statement-breakpoint
ALTER TABLE "live_comments" ADD COLUMN IF NOT EXISTS "product_reference" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "buying_intent_queue" ADD CONSTRAINT "buying_intent_queue_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "buying_intent_queue" ADD CONSTRAINT "buying_intent_queue_live_session_id_live_sessions_id_fk" FOREIGN KEY ("live_session_id") REFERENCES "public"."live_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "buying_intent_queue" ADD CONSTRAINT "buying_intent_queue_latest_comment_id_live_comments_id_fk" FOREIGN KEY ("latest_comment_id") REFERENCES "public"."live_comments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "buying_intent_queue_session_username_unique" ON "buying_intent_queue" USING btree ("live_session_id","tiktok_username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buying_intent_queue_shop_session_status_idx" ON "buying_intent_queue" USING btree ("shop_id","live_session_id","status");