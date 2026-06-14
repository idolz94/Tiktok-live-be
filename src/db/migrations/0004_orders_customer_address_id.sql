ALTER TABLE "orders"
  ADD COLUMN "customer_address_id" UUID REFERENCES "customer_addresses"("id") ON DELETE SET NULL;
