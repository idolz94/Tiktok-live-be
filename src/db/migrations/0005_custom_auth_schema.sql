-- Migration: Replace Clerk-based auth with custom auth
-- Drops: profiles, rewrites shops/shop_members/live_sessions/orders FKs
-- Adds: users, oauth_accounts, refresh_tokens
-- Adds: activated_by on shop_licenses
-- Adds: api_token, partner_code, extra_config on shop_shipping_providers
-- Run ONCE on a clean database. Existing data will be lost.

-- ─── Safety check ──────────────────────────────────────────────────────────────
-- This migration drops profiles and rebuilds auth-related columns.
-- Back up data before running in production.

BEGIN;

-- ─── Drop Clerk-era tables and columns ────────────────────────────────────────

-- Drop FK constraints that reference profiles.id (text Clerk id)
ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_owner_id_fkey;
ALTER TABLE shop_members DROP CONSTRAINT IF EXISTS shop_members_user_id_fkey;
ALTER TABLE shop_members DROP CONSTRAINT IF EXISTS shop_members_invited_by_fkey;
ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_created_by_fkey;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_created_by_fkey;

DROP TABLE IF EXISTS profiles CASCADE;

-- ─── Create users ─────────────────────────────────────────────────────────────

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT,
  full_name TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Create oauth_accounts ────────────────────────────────────────────────────

CREATE TABLE oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id)
);

-- ─── Create refresh_tokens ────────────────────────────────────────────────────

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Migrate shops.owner_id: text → uuid ──────────────────────────────────────

ALTER TABLE shops
  ALTER COLUMN owner_id TYPE UUID USING NULL,
  ALTER COLUMN owner_id SET NOT NULL,
  ADD CONSTRAINT shops_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

-- ─── Migrate shop_members.user_id / invited_by: text → uuid ──────────────────

ALTER TABLE shop_members
  ALTER COLUMN user_id TYPE UUID USING NULL,
  ALTER COLUMN user_id SET NOT NULL,
  ADD CONSTRAINT shop_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE shop_members
  ALTER COLUMN invited_by TYPE UUID USING NULL,
  ADD CONSTRAINT shop_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES users(id);

-- ─── Migrate live_sessions.created_by: text → uuid ───────────────────────────

ALTER TABLE live_sessions
  ALTER COLUMN created_by TYPE UUID USING NULL,
  ADD CONSTRAINT live_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);

-- ─── Migrate orders.created_by: text → uuid ──────────────────────────────────

ALTER TABLE orders
  ALTER COLUMN created_by TYPE UUID USING NULL,
  ADD CONSTRAINT orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);

-- ─── Add activated_by to shop_licenses ───────────────────────────────────────

ALTER TABLE shop_licenses
  ADD COLUMN IF NOT EXISTS activated_by UUID REFERENCES users(id);

-- ─── Add api_token, partner_code, extra_config to shop_shipping_providers ─────

ALTER TABLE shop_shipping_providers
  ADD COLUMN IF NOT EXISTS api_token TEXT,
  ADD COLUMN IF NOT EXISTS partner_code TEXT,
  ADD COLUMN IF NOT EXISTS extra_config JSONB;

-- ─── Add unique constraint on shop_members (shop_id, user_id) ─────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shop_members_shop_user_unique'
  ) THEN
    ALTER TABLE shop_members ADD CONSTRAINT shop_members_shop_user_unique UNIQUE (shop_id, user_id);
  END IF;
END$$;

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_shops_owner_id ON shops(owner_id);
CREATE INDEX IF NOT EXISTS idx_shop_members_user_id ON shop_members(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_licenses_shop_id ON shop_licenses(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_licenses_activated_by ON shop_licenses(activated_by);

COMMIT;
