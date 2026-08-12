-- Persist full rule-result fields for live comments.
-- Keep can_create_order as the legacy compatibility alias.

ALTER TABLE live_comments
  ADD COLUMN IF NOT EXISTS can_suggest_order boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_create_draft_order boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_potential_buyer boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS matched_reasons jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rule_version text DEFAULT 'comment-rules-v1';
