-- ponytail: minimal buying-intent queue for Phase 1 (one row per tiktok username per live session)

CREATE TABLE IF NOT EXISTS "buying_intent_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id" uuid NOT NULL,
  "live_session_id" uuid NOT NULL,
  "tiktok_username" text NOT NULL,
  "display_name" text,
  "avatar_url" text,
  "intent" text NOT NULL DEFAULT 'buy',
  "priority_level" text NOT NULL DEFAULT 'high',
  "final_score" real DEFAULT 0,
  "comment_count" integer DEFAULT 1,
  "latest_comment_id" uuid,
  "latest_comment_text" text,
  "latest_comment_at" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'pending',
  "handled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "buying_intent_queue_session_username_unique"
  ON "buying_intent_queue" ("live_session_id", "tiktok_username");

CREATE INDEX IF NOT EXISTS "buying_intent_queue_shop_session_status_idx"
  ON "buying_intent_queue" ("shop_id", "live_session_id", "status");
