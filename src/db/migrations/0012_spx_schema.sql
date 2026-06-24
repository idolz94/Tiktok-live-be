-- SPX integration: additive columns + indexes
-- Rollback: see bottom of file

-- order_shipments: SPX-specific columns (all nullable)
ALTER TABLE order_shipments
  ADD COLUMN IF NOT EXISTS spx_tracking_no         TEXT,
  ADD COLUMN IF NOT EXISTS service_type            SMALLINT,
  ADD COLUMN IF NOT EXISTS collect_type            SMALLINT,
  ADD COLUMN IF NOT EXISTS pickup_time             BIGINT,
  ADD COLUMN IF NOT EXISTS pickup_time_range_id    BIGINT,
  ADD COLUMN IF NOT EXISTS provider_shipping_fee   INTEGER,
  ADD COLUMN IF NOT EXISTS parcel_weight_gram      INTEGER,
  ADD COLUMN IF NOT EXISTS parcel_length_cm        INTEGER,
  ADD COLUMN IF NOT EXISTS parcel_width_cm         INTEGER,
  ADD COLUMN IF NOT EXISTS parcel_height_cm        INTEGER,
  ADD COLUMN IF NOT EXISTS parcel_item_name        TEXT,
  ADD COLUMN IF NOT EXISTS declared_value          INTEGER,
  ADD COLUMN IF NOT EXISTS sender_name             TEXT,
  ADD COLUMN IF NOT EXISTS sender_phone            TEXT,
  ADD COLUMN IF NOT EXISTS sender_province         TEXT,
  ADD COLUMN IF NOT EXISTS sender_district         TEXT,
  ADD COLUMN IF NOT EXISTS sender_ward             TEXT,
  ADD COLUMN IF NOT EXISTS sender_detail_address   TEXT,
  ADD COLUMN IF NOT EXISTS receiver_name           TEXT,
  ADD COLUMN IF NOT EXISTS receiver_phone          TEXT,
  ADD COLUMN IF NOT EXISTS receiver_province       TEXT,
  ADD COLUMN IF NOT EXISTS receiver_district       TEXT,
  ADD COLUMN IF NOT EXISTS receiver_ward           TEXT,
  ADD COLUMN IF NOT EXISTS receiver_detail_address TEXT,
  ADD COLUMN IF NOT EXISTS label_expires_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key         TEXT,
  ADD COLUMN IF NOT EXISTS error_code              TEXT,
  ADD COLUMN IF NOT EXISTS error_message           TEXT;

-- shop_shipping_providers: environment flag (sandbox vs production)
ALTER TABLE shop_shipping_providers
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'production';

-- Partial unique: prevent duplicate idempotency keys
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_shipments_idempotency_key
  ON order_shipments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Partial unique: one active shipment per order
-- Excludes both spellings present in codebase
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_shipments_active_per_order
  ON order_shipments (order_id)
  WHERE status NOT IN ('cancelled', 'canceled');

-- Index for webhook lookup by SPX tracking number
CREATE INDEX IF NOT EXISTS idx_order_shipments_spx_tracking_no
  ON order_shipments (spx_tracking_no)
  WHERE spx_tracking_no IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_order_shipments_idempotency_key;
-- DROP INDEX IF EXISTS idx_order_shipments_active_per_order;
-- DROP INDEX IF EXISTS idx_order_shipments_spx_tracking_no;
-- ALTER TABLE order_shipments
--   DROP COLUMN IF EXISTS spx_tracking_no,
--   DROP COLUMN IF EXISTS service_type,
--   DROP COLUMN IF EXISTS collect_type,
--   DROP COLUMN IF EXISTS pickup_time,
--   DROP COLUMN IF EXISTS pickup_time_range_id,
--   DROP COLUMN IF EXISTS provider_shipping_fee,
--   DROP COLUMN IF EXISTS parcel_weight_gram,
--   DROP COLUMN IF EXISTS parcel_length_cm,
--   DROP COLUMN IF EXISTS parcel_width_cm,
--   DROP COLUMN IF EXISTS parcel_height_cm,
--   DROP COLUMN IF EXISTS parcel_item_name,
--   DROP COLUMN IF EXISTS declared_value,
--   DROP COLUMN IF EXISTS sender_name,
--   DROP COLUMN IF EXISTS sender_phone,
--   DROP COLUMN IF EXISTS sender_province,
--   DROP COLUMN IF EXISTS sender_district,
--   DROP COLUMN IF EXISTS sender_ward,
--   DROP COLUMN IF EXISTS sender_detail_address,
--   DROP COLUMN IF EXISTS receiver_name,
--   DROP COLUMN IF EXISTS receiver_phone,
--   DROP COLUMN IF EXISTS receiver_province,
--   DROP COLUMN IF EXISTS receiver_district,
--   DROP COLUMN IF EXISTS receiver_ward,
--   DROP COLUMN IF EXISTS receiver_detail_address,
--   DROP COLUMN IF EXISTS label_expires_at,
--   DROP COLUMN IF EXISTS idempotency_key,
--   DROP COLUMN IF EXISTS error_code,
--   DROP COLUMN IF EXISTS error_message;
-- ALTER TABLE shop_shipping_providers DROP COLUMN IF EXISTS environment;
