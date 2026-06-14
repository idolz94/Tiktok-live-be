-- Migration: add unique index on orders.order_code
-- Safe to run: only fails if there are existing duplicate order_code values (unlikely with timestamp-based old codes)
-- Run: psql $DATABASE_URL -f this_file.sql

CREATE UNIQUE INDEX IF NOT EXISTS "orders_order_code_unique" ON "orders" ("order_code");
