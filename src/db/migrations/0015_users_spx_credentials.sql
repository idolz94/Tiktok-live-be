ALTER TABLE users
  ADD COLUMN IF NOT EXISTS spx_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS spx_user_secret TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_spx_user_id
  ON users (spx_user_id) WHERE spx_user_id IS NOT NULL;
