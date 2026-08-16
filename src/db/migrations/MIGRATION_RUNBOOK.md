# Migration runbook — shipping redesign

## Context

Migrations `0008`, `0009`, and `0010` must run on any production database that was
initialized with `0000`–`0007` (or `0006` full-rebuild). They are idempotent (`IF NOT EXISTS`,
`WHERE ... IS NULL`, `ON CONFLICT DO UPDATE`) and can be run safely on a live DB.

Fresh installs: run `0006_full_schema_rebuild.sql` then `0008`, `0009`, `0010`.

## Run order

```
0008_shipping_redesign_additive.sql   -- ADD COLUMN, CREATE TABLE, seed shipping_providers
0009_shipping_redesign_backfill.sql   -- UPDATE existing rows, INSERT seed events
0010_shipping_money_integer.sql       -- ALTER COLUMN TYPE for money fields
0016_live_comment_analytics.sql       -- ADD COLUMN, dedupe live_comments, add analytics indexes
0017_admin_audit_logs_soft_delete.sql -- CREATE admin_audit_logs, ADD deleted_at on users/shops/orders
```

## 0016 — live comment analytics foundation

Adds the fields that the TikTok live analytics foundation needs on `live_comments`:

| Column | Type | Default |
|--------|------|---------|
| `customer_id` | uuid FK customers | `NULL` |
| `is_question` | boolean | `false` |
| `matched_product_code` | text | — |

Before creating the session-scoped unique index, the migration removes duplicate `live_comments`
rows that share the same non-null `live_session_id + external_comment_id`, keeping the newest row.

Adds indexes for:

- `live_comments.customer_id + created_at`
- `live_comments.matched_product_code + created_at`

This migration is idempotent (`IF NOT EXISTS`) and safe to re-run on a live DB.

## 0016 verification queries

Run after applying `0016_live_comment_analytics.sql` to verify:

```sql
-- live_comments analytics columns exist
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'live_comments'
  AND column_name IN ('customer_id', 'is_question', 'matched_product_code')
ORDER BY column_name;

-- session-scoped live comment dedupe index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'live_comments'
  AND indexname = 'live_comments_session_external_comment_id_unique';

-- analytics indexes exist
SELECT indexname
FROM pg_indexes
WHERE tablename = 'live_comments'
  AND indexname IN (
    'live_comments_customer_id_created_at_idx',
    'live_comments_matched_product_code_created_at_idx'
  )
ORDER BY indexname;
```

## 0017 — admin audit logs + soft delete columns

Creates the `admin_audit_logs` table with structured before/after JSON snapshots,
request metadata, a foreign key to `users.id`, and composite indexes on
`(target_type, target_id)` and `(admin_user_id, created_at)`.

Adds nullable `deleted_at` timestamptz columns to `users`, `shops`, and `orders`
for future soft-delete archival workflows.

This migration is idempotent (`IF NOT EXISTS`, `DO $$ ... END $$`) and safe to
re-run on a live DB.

## 0017 verification queries

Run after applying `0017_admin_audit_logs_soft_delete.sql` to verify:

```sql
-- admin_audit_logs table exists with correct columns
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'admin_audit_logs'
ORDER BY ordinal_position;

-- foreign key exists
SELECT constraint_name
FROM information_schema.table_constraints
WHERE table_name = 'admin_audit_logs'
  AND constraint_type = 'FOREIGN KEY';

-- composite indexes exist
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'admin_audit_logs'
  AND indexname IN (
    'admin_audit_logs_target_idx',
    'admin_audit_logs_admin_created_at_idx'
  )
ORDER BY indexname;

-- soft-delete columns exist
SELECT table_name, column_name
FROM information_schema.columns
WHERE column_name = 'deleted_at'
  AND table_name IN ('users', 'shops', 'orders')
ORDER BY table_name;
```

## What each migration does

### 0008 — additive schema changes

Adds the columns that the shipping redesign needs to `order_shipments`:

| Column | Type | Default |
|--------|------|---------|
| `tracking_code` | text | — |
| `shipping_fee` | integer | — |
| `cod_amount` | integer | — |
| `status` | text | `'submitted'` NOT NULL |
| `status_raw` | text | — |
| `payment_side` | text | — |
| `label_url` | text | — |
| `label_format` | text | — |
| `label_paper_size` | text | — |
| `cancelled_at` | timestamptz | — |
| `cancel_reason` | text | — |
| `created_by_user_id` | uuid FK users | — |
| `updated_at` | timestamptz | `now()` NOT NULL |

Creates `shipment_events` table (if not exists) with indexes.

Seeds `shipping_providers` rows for `ghtk`, `spx`, and `manual`.

Adds `extra_config` jsonb and `updated_at` to `shop_shipping_providers`.

### 0009 — backfill

- Lowercases `order_shipments.provider_code`.
- Sets `status` for rows where it is NULL (maps from `status_code` via GHTK rules or defaults to `'submitted'`).
- Copies `status_code` → `status_raw` where `status_raw` is NULL.
- Defaults `payment_side` = `'recipient_pays'`, `label_format` = `'pdf'`, `label_paper_size` = `'A4'` where NULL.
- Inserts a `'created'` event into `shipment_events` for every shipment that has no events yet.

### 0010 — integer money

Converts `orders` money columns from `real` to `integer` (rounds to nearest VND):

- `subtotal_amount`, `shipping_fee`, `discount_amount`, `deposit_amount`, `cod_amount`, `total_amount`

Converts `order_shipments.fee` from `real` to `integer`.

## Drizzle journal state

The Drizzle journal (`meta/_journal.json`) only tracks `0000` and `0001` — the two
auto-generated migrations. Migrations `0002`–`0010` were written by hand and are
**outside Drizzle's snapshot knowledge**.

Do NOT run `db:generate` expecting it to produce `0008`/`0009`/`0010` — they already
exist. Running `db:generate` now would produce a diff that re-adds the columns that were
added manually, resulting in duplicate-column errors.

To bring Drizzle's snapshot up to date after applying all manual migrations, run:

```bash
npm run db:push   # only on dev/staging — will introspect live DB and sync
```

Or regenerate the snapshot by running `db:generate` once against a DB that already has
`0008–0010` applied and verifying the output is empty (no-op diff).

## Orders backfill — shipping_status

The `orders.shipping_status` column defaults to `'not_shipped'`. Existing orders already
have correct values because the default was set when the column was added. No manual
backfill needed.

The `orders.provider_code` column was added in `0001`/`0002` and is optional — it stores
the provider used when shipping was submitted directly from the order (legacy path). New
shipments use `order_shipments.provider_code` as the canonical source.

## Verification queries

Run after applying all migrations to verify:

```sql
-- All order_shipments have a valid status
SELECT status, count(*)
FROM order_shipments
GROUP BY status;
-- Expected statuses: submitted, waiting_pickup, shipping, delivered, cancelled, returned, failed

-- All shipments have at least one event
SELECT count(*) FROM order_shipments os
WHERE NOT EXISTS (
  SELECT 1 FROM shipment_events se WHERE se.shipment_id = os.id
);
-- Expected: 0

-- shipping_providers seeded
SELECT code, name, status FROM shipping_providers ORDER BY code;
-- Expected: ghtk, manual, spx

-- Money columns are integers (not real)
SELECT pg_typeof(subtotal_amount) FROM orders LIMIT 1;
-- Expected: integer
```
