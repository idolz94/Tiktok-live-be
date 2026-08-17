ALTER TABLE "buying_intent_queue" ADD COLUMN "parsed_data" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "buying_intent_queue" ADD COLUMN "suggested_reply" text;--> statement-breakpoint
ALTER TABLE "buying_intent_queue" ADD COLUMN "missing_fields" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "buying_intent_queue" ADD COLUMN "can_create_draft_order" boolean DEFAULT false;