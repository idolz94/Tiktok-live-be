ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "ghtk_label" text,
  ADD COLUMN IF NOT EXISTS "ghtk_tracking_id" text,
  ADD COLUMN IF NOT EXISTS "ghtk_fee" integer,
  ADD COLUMN IF NOT EXISTS "ghtk_status_id" integer,
  ADD COLUMN IF NOT EXISTS "ghtk_submitted_at" timestamp;
