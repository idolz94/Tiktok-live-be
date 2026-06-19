-- Backfill migration for shipping redesign

UPDATE order_shipments
SET provider_code = lower(provider_code)
WHERE provider_code IS NOT NULL;

UPDATE order_shipments
SET status = CASE
  WHEN lower(provider_code) = 'ghtk' THEN
    CASE
      WHEN status_code = '-1' THEN 'cancelled'
      WHEN status_code IN ('5', '6') THEN 'delivered'
      WHEN status_code IN ('9', '20', '21') THEN 'returned'
      ELSE 'submitted'
    END
  WHEN lower(provider_code) = 'manual' THEN 'submitted'
  ELSE COALESCE(status, 'submitted')
END
WHERE status IS NULL;

UPDATE order_shipments
SET status_raw = status_code
WHERE status_raw IS NULL AND status_code IS NOT NULL;

UPDATE order_shipments
SET payment_side = COALESCE(payment_side, 'recipient_pays')
WHERE payment_side IS NULL;

UPDATE order_shipments
SET label_format = COALESCE(label_format, 'pdf')
WHERE label_format IS NULL;

UPDATE order_shipments
SET label_paper_size = COALESCE(label_paper_size, 'A4')
WHERE label_paper_size IS NULL;

INSERT INTO shipment_events (
  shipment_id,
  order_id,
  shop_id,
  event_type,
  from_status,
  to_status,
  provider_status_raw,
  payload,
  created_at
)
SELECT
  os.id,
  os.order_id,
  os.shop_id,
  'created',
  NULL,
  os.status,
  os.status_raw,
  os.raw_response,
  COALESCE(os.submitted_at, os.created_at, now())
FROM order_shipments os
WHERE NOT EXISTS (
  SELECT 1
  FROM shipment_events se
  WHERE se.shipment_id = os.id
);
