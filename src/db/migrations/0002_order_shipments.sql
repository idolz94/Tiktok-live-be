-- Remove ghtk-specific columns from orders
ALTER TABLE "orders" DROP COLUMN IF EXISTS "ghtk_label";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "ghtk_tracking_id";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "ghtk_fee";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "ghtk_status_id";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "ghtk_submitted_at";

-- Add generic provider_code to orders
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "provider_code" text;

-- Create polymorphic order_shipments table
CREATE TABLE IF NOT EXISTS "order_shipments" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id"              uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "shop_id"               uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "provider_code"         text NOT NULL,
  "tracking_label"        text,
  "external_order_id"     text,
  "fee"                   integer,
  "status_code"           text,
  "submitted_at"          timestamp,
  "estimated_pick_time"   text,
  "estimated_deliver_time" text,
  "raw_response"          jsonb,
  "created_at"            timestamp DEFAULT now(),
  "updated_at"            timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "order_shipments_order_id_idx" ON "order_shipments"("order_id");
CREATE INDEX IF NOT EXISTS "order_shipments_shop_id_idx" ON "order_shipments"("shop_id");
