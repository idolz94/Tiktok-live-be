-- Add profile fields to customers table
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_type  TEXT DEFAULT 'retail',
  ADD COLUMN IF NOT EXISTS phone          TEXT,
  ADD COLUMN IF NOT EXISTS reference_info TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address TEXT;
