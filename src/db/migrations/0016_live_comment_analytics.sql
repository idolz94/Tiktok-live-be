-- Additive migration for live comment analytics foundation.
-- Keep existing live flow compatible while metrics fields are added.

ALTER TABLE live_comments
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_question boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS matched_product_code text;

-- ponytail: keep the newest duplicate before enforcing session-scoped comment dedupe.
DELETE FROM live_comments lc
USING live_comments newer
WHERE lc.live_session_id IS NOT NULL
  AND lc.external_comment_id IS NOT NULL
  AND newer.live_session_id = lc.live_session_id
  AND newer.external_comment_id = lc.external_comment_id
  AND (
    newer.created_at > lc.created_at
    OR (newer.created_at = lc.created_at AND newer.id > lc.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS live_comments_session_external_comment_id_unique
  ON live_comments (live_session_id, external_comment_id);

CREATE INDEX IF NOT EXISTS live_comments_customer_id_created_at_idx
  ON live_comments (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS live_comments_matched_product_code_created_at_idx
  ON live_comments (matched_product_code, created_at DESC);
