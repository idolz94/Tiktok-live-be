-- 0017: admin_audit_logs table + soft-delete columns
-- Idempotent: safe to re-run against a live database that already has these objects.
-- Covers tasks 2.1-2.3 of add-admin-audit-foundation.

-- ─── admin_audit_logs table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ─── foreign key on admin_user_id → users.id ─────────────────────────────────
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.table_constraints
		WHERE constraint_name = 'admin_audit_logs_admin_user_id_users_id_fk'
		  AND table_name = 'admin_audit_logs'
	) THEN
		ALTER TABLE "admin_audit_logs"
			ADD CONSTRAINT "admin_audit_logs_admin_user_id_users_id_fk"
			FOREIGN KEY ("admin_user_id")
			REFERENCES "public"."users"("id")
			ON DELETE no action ON UPDATE no action;
	END IF;
END $$;

-- ─── composite indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "admin_audit_logs_target_idx"
	ON "admin_audit_logs" USING btree ("target_type", "target_id");

CREATE INDEX IF NOT EXISTS "admin_audit_logs_admin_created_at_idx"
	ON "admin_audit_logs" USING btree ("admin_user_id", "created_at");

-- ─── soft-delete columns (nullable, no default) ──────────────────────────────
ALTER TABLE "users"  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
ALTER TABLE "shops"  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
