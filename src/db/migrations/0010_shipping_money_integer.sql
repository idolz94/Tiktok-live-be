-- Normalize VND money columns to integer

ALTER TABLE orders
  ALTER COLUMN subtotal_amount TYPE integer USING round(subtotal_amount)::integer,
  ALTER COLUMN shipping_fee TYPE integer USING round(shipping_fee)::integer,
  ALTER COLUMN discount_amount TYPE integer USING round(discount_amount)::integer,
  ALTER COLUMN deposit_amount TYPE integer USING round(deposit_amount)::integer,
  ALTER COLUMN cod_amount TYPE integer USING round(cod_amount)::integer,
  ALTER COLUMN total_amount TYPE integer USING round(total_amount)::integer;

ALTER TABLE order_shipments
  ALTER COLUMN fee TYPE integer USING round(fee)::integer;
