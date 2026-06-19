-- Additive migration for shipping redesign
-- Keep legacy fields for compatibility during transition.

ALTER TABLE order_shipments
  ADD COLUMN IF NOT EXISTS tracking_code text,
  ADD COLUMN IF NOT EXISTS shipping_fee integer,
  ADD COLUMN IF NOT EXISTS cod_amount integer,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'submitted' NOT NULL,
  ADD COLUMN IF NOT EXISTS status_raw text,
  ADD COLUMN IF NOT EXISTS payment_side text,
  ADD COLUMN IF NOT EXISTS label_url text,
  ADD COLUMN IF NOT EXISTS label_format text,
  ADD COLUMN IF NOT EXISTS label_paper_size text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES order_shipments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  provider_status_raw text,
  payload jsonb,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shipment_events_shipment_id_created_at_idx
  ON shipment_events (shipment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS shipment_events_order_id_created_at_idx
  ON shipment_events (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS shipment_events_shop_id_created_at_idx
  ON shipment_events (shop_id, created_at DESC);

INSERT INTO shipping_providers (code, name, status, created_at, updated_at)
VALUES
  ('ghtk', 'Giao Hàng Tiết Kiệm', 'active', now(), now()),
  ('spx', 'Shopee Express', 'active', now(), now()),
  ('manual', 'Thủ công', 'active', now(), now())
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  updated_at = now();

ALTER TABLE shop_shipping_providers
  ADD COLUMN IF NOT EXISTS extra_config jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
