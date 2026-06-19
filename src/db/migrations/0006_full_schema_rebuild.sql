-- Migration: Full schema rebuild matching current Drizzle schema
-- Replaces all previous migrations. Run on a fresh database.
-- Auth: custom JWT (no Clerk). Money: integer VND.
-- 2026-06-19

BEGIN;

-- ─── Extensions ───────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── users ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT        NOT NULL UNIQUE,
  email         TEXT        UNIQUE,
  phone         TEXT        UNIQUE,
  password_hash TEXT,
  full_name     TEXT,
  avatar_url    TEXT,
  status        TEXT        NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx  ON users (email);
CREATE INDEX IF NOT EXISTS users_phone_idx  ON users (phone);

-- ─── oauth_accounts ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT        NOT NULL,
  provider_user_id TEXT        NOT NULL,
  email            TEXT,
  access_token     TEXT,
  refresh_token    TEXT,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_accounts_provider_user_unique UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS oauth_accounts_user_id_idx ON oauth_accounts (user_id);

-- ─── refresh_tokens ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens (user_id);

-- ─── license_plans ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS license_plans (
  code                      TEXT    PRIMARY KEY,
  name                      TEXT    NOT NULL,
  description               TEXT,
  price_monthly             INTEGER NOT NULL DEFAULT 0,
  max_orders_per_month      INTEGER,
  max_live_sessions_per_month INTEGER,
  max_members               INTEGER,
  max_tiktok_accounts       INTEGER,
  can_print                 BOOLEAN NOT NULL DEFAULT FALSE,
  can_export_excel          BOOLEAN NOT NULL DEFAULT FALSE,
  can_use_reports           BOOLEAN NOT NULL DEFAULT FALSE,
  can_use_shipping          BOOLEAN NOT NULL DEFAULT FALSE,
  status                    TEXT    NOT NULL DEFAULT 'active',
  sort_order                INTEGER NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO license_plans (code, name, description, price_monthly, status, sort_order)
VALUES ('trial', 'Trial', 'Gói dùng thử miễn phí', 0, 'active', 0)
ON CONFLICT (code) DO NOTHING;

-- ─── shops ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shops (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID        NOT NULL REFERENCES users(id),
  name                  TEXT        NOT NULL,
  phone                 TEXT,
  default_tiktok_username TEXT,
  status                TEXT        NOT NULL DEFAULT 'active',
  license_status        TEXT        NOT NULL DEFAULT 'trial',
  license_expired_at    TIMESTAMPTZ,
  trial_ends_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shops_owner_id_idx ON shops (owner_id);

-- ─── shop_members ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shop_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL DEFAULT 'owner',
  status     TEXT        NOT NULL DEFAULT 'active',
  invited_by UUID        REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shop_members_shop_user_unique UNIQUE (shop_id, user_id)
);

CREATE INDEX IF NOT EXISTS shop_members_user_id_idx  ON shop_members (user_id);
CREATE INDEX IF NOT EXISTS shop_members_shop_id_idx  ON shop_members (shop_id);

-- ─── shop_licenses ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shop_licenses (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                   UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  plan_code                 TEXT        NOT NULL REFERENCES license_plans(code),
  status                    TEXT        NOT NULL DEFAULT 'trial',
  started_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expired_at                TIMESTAMPTZ,
  trial_ends_at             TIMESTAMPTZ,
  is_current                BOOLEAN     NOT NULL DEFAULT TRUE,
  max_orders_per_month      INTEGER,
  max_live_sessions_per_month INTEGER,
  max_members               INTEGER,
  max_tiktok_accounts       INTEGER,
  price                     INTEGER     NOT NULL DEFAULT 0,
  currency                  TEXT        NOT NULL DEFAULT 'VND',
  payment_status            TEXT        NOT NULL DEFAULT 'unpaid',
  last_payment_at           TIMESTAMPTZ,
  activated_by              UUID        REFERENCES users(id),
  note                      TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shop_licenses_shop_id_idx ON shop_licenses (shop_id);

-- ─── shop_tiktok_channels ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shop_tiktok_channels (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  tiktok_username  TEXT        NOT NULL,
  display_name     TEXT,
  is_default       BOOLEAN     NOT NULL DEFAULT FALSE,
  status           TEXT        NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shop_tiktok_channels_shop_id_idx ON shop_tiktok_channels (shop_id);

-- ─── live_sessions ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS live_sessions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  created_by          UUID        REFERENCES users(id),
  external_session_id TEXT,
  tiktok_username     TEXT,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  duration_seconds    INTEGER     NOT NULL DEFAULT 0,
  comment_count       INTEGER     NOT NULL DEFAULT 0,
  order_count         INTEGER     NOT NULL DEFAULT 0,
  customer_count      INTEGER     NOT NULL DEFAULT 0,
  status              TEXT        NOT NULL DEFAULT 'running',
  end_reason          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS live_sessions_shop_id_created_at_idx ON live_sessions (shop_id, created_at);
CREATE INDEX IF NOT EXISTS live_sessions_created_by_idx         ON live_sessions (created_by);

-- ─── customers ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  tiktok_username  TEXT,
  tiktok_unique_id TEXT,
  display_name     TEXT,
  avatar_url       TEXT,
  phone            TEXT,
  address          TEXT,
  shipping_address TEXT,
  customer_type    TEXT,
  reference_info   TEXT,
  note             TEXT,
  tags             JSONB       NOT NULL DEFAULT '[]',
  total_orders     INTEGER     NOT NULL DEFAULT 0,
  total_spent      INTEGER     NOT NULL DEFAULT 0,
  last_order_at    TIMESTAMPTZ,
  status           TEXT        NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customers_shop_id_idx             ON customers (shop_id);
CREATE INDEX IF NOT EXISTS customers_shop_tiktok_unique_idx  ON customers (shop_id, tiktok_unique_id);

-- ─── shop_addresses ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shop_addresses (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  label      TEXT,
  name       TEXT,
  phone      TEXT,
  address    TEXT,
  province   TEXT,
  district   TEXT,
  ward       TEXT,
  is_default BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shop_addresses_shop_id_idx ON shop_addresses (shop_id);

-- ─── customer_addresses ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_addresses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  shop_id     UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  label       TEXT,
  name        TEXT,
  phone       TEXT,
  address     TEXT,
  province    TEXT,
  district    TEXT,
  ward        TEXT,
  is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_addresses_customer_id_idx ON customer_addresses (customer_id);
CREATE INDEX IF NOT EXISTS customer_addresses_shop_id_idx     ON customer_addresses (shop_id);

-- ─── orders ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                   UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  live_session_id           UUID        REFERENCES live_sessions(id),
  customer_id               UUID        REFERENCES customers(id),
  live_comment_id           UUID,
  customer_address_id       UUID        REFERENCES customer_addresses(id) ON DELETE SET NULL,
  order_code                TEXT        UNIQUE,
  source                    TEXT        NOT NULL DEFAULT 'live_comment',
  customer_name             TEXT,
  customer_tiktok_username  TEXT,
  customer_phone            TEXT,
  customer_address          TEXT,
  comment_text              TEXT,
  color                     TEXT,
  status                    TEXT        NOT NULL DEFAULT 'draft',
  deposit_status            TEXT        NOT NULL DEFAULT 'unpaid',
  payment_status            TEXT        NOT NULL DEFAULT 'unpaid',
  shipping_status           TEXT        NOT NULL DEFAULT 'not_shipped',
  subtotal_amount           INTEGER     NOT NULL DEFAULT 0,
  shipping_fee              INTEGER     NOT NULL DEFAULT 0,
  discount_amount           INTEGER     NOT NULL DEFAULT 0,
  deposit_amount            INTEGER     NOT NULL DEFAULT 0,
  cod_amount                INTEGER     NOT NULL DEFAULT 0,
  total_amount              INTEGER     NOT NULL DEFAULT 0,
  currency                  TEXT        NOT NULL DEFAULT 'VND',
  note                      TEXT,
  created_by                UUID        REFERENCES users(id),
  confirmed_at              TIMESTAMPTZ,
  canceled_at               TIMESTAMPTZ,
  provider_code             TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_shop_id_created_at_idx    ON orders (shop_id, created_at);
CREATE INDEX IF NOT EXISTS orders_live_session_id_idx       ON orders (live_session_id);
CREATE INDEX IF NOT EXISTS orders_customer_id_idx           ON orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_created_by_idx            ON orders (created_by);

-- ─── order_items ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shop_id          UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_code     TEXT,
  product_name     TEXT,
  variant_name     TEXT,
  color            TEXT,
  size             TEXT,
  quantity         INTEGER     NOT NULL DEFAULT 1,
  price            INTEGER     NOT NULL DEFAULT 0,
  raw_comment_text TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_shop_id_idx  ON order_items (shop_id);

-- ─── order_shipments ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_shipments (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shop_id               UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  provider_code         TEXT        NOT NULL,
  tracking_label        TEXT,
  external_order_id     TEXT,
  fee                   INTEGER,
  status_code           TEXT,
  submitted_at          TIMESTAMPTZ,
  estimated_pick_time   TEXT,
  estimated_deliver_time TEXT,
  raw_response          JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_shipments_order_id_idx ON order_shipments (order_id);
CREATE INDEX IF NOT EXISTS order_shipments_shop_id_idx  ON order_shipments (shop_id);

-- ─── live_comments ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS live_comments (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  live_session_id     UUID        REFERENCES live_sessions(id),
  external_comment_id TEXT,
  tiktok_comment_id   TEXT,
  dedup_key           TEXT,
  tiktok_username     TEXT,
  tiktok_unique_id    TEXT,
  display_name        TEXT,
  avatar_url          TEXT,
  comment_text        TEXT,
  text                TEXT,
  raw_text            TEXT,
  intent              TEXT        NOT NULL DEFAULT 'normal',
  priority_level      TEXT        NOT NULL DEFAULT 'normal',
  final_score         REAL        NOT NULL DEFAULT 0,
  has_number          BOOLEAN     NOT NULL DEFAULT FALSE,
  can_create_order    BOOLEAN     NOT NULL DEFAULT FALSE,
  is_order_created    BOOLEAN     NOT NULL DEFAULT FALSE,
  order_id            UUID,
  raw_payload         JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT live_comments_shop_external_comment_id_unique UNIQUE (shop_id, external_comment_id)
);

CREATE INDEX IF NOT EXISTS live_comments_shop_id_created_at_idx     ON live_comments (shop_id, created_at);
CREATE INDEX IF NOT EXISTS live_comments_live_session_id_created_at_idx ON live_comments (live_session_id, created_at);

-- ─── payments ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  provider     TEXT        NOT NULL DEFAULT 'manual',
  payment_code TEXT,
  plan_code    TEXT        REFERENCES license_plans(code),
  months       INTEGER     NOT NULL DEFAULT 1,
  amount       INTEGER     NOT NULL DEFAULT 0,
  currency     TEXT        NOT NULL DEFAULT 'VND',
  status       TEXT        NOT NULL DEFAULT 'pending',
  checkout_url TEXT,
  paid_at      TIMESTAMPTZ,
  raw_payload  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_shop_id_idx ON payments (shop_id);

-- ─── shop_settings ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shop_settings (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  key        TEXT        NOT NULL,
  value      JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shop_settings_shop_key_unique UNIQUE (shop_id, key)
);

CREATE INDEX IF NOT EXISTS shop_settings_shop_id_idx ON shop_settings (shop_id);

-- ─── shipping_providers ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shipping_providers (
  code       TEXT        PRIMARY KEY,
  name       TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO shipping_providers (code, name) VALUES
  ('ghn',  'Giao Hàng Nhanh'),
  ('ghtk', 'Giao Hàng Tiết Kiệm'),
  ('vtp',  'Viettel Post')
ON CONFLICT (code) DO NOTHING;

-- ─── shop_shipping_providers ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shop_shipping_providers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  provider_code TEXT        NOT NULL REFERENCES shipping_providers(code),
  is_enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
  api_token     TEXT,
  partner_code  TEXT,
  extra_config  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shop_shipping_providers_shop_provider_unique UNIQUE (shop_id, provider_code)
);

CREATE INDEX IF NOT EXISTS shop_shipping_providers_shop_id_idx ON shop_shipping_providers (shop_id);

-- ─── shop_product_presets ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shop_product_presets (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  code       TEXT        NOT NULL,
  name       TEXT,
  color      TEXT,
  price      INTEGER     NOT NULL DEFAULT 0,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shop_product_presets_shop_id_idx ON shop_product_presets (shop_id);

COMMIT;
