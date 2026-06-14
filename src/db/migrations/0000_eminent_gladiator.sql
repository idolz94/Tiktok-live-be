CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"label" text,
	"phone" text,
	"address" text,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"tiktok_username" text,
	"tiktok_unique_id" text,
	"display_name" text,
	"avatar_url" text,
	"phone" text,
	"address" text,
	"shipping_address" text,
	"customer_type" text,
	"reference_info" text,
	"note" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"total_orders" integer DEFAULT 0,
	"total_spent" real DEFAULT 0,
	"last_order_at" timestamp,
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "license_plans" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_monthly" real DEFAULT 0,
	"max_orders_per_month" integer,
	"max_live_sessions_per_month" integer,
	"max_members" integer,
	"max_tiktok_accounts" integer,
	"can_print" boolean DEFAULT false,
	"can_export_excel" boolean DEFAULT false,
	"can_use_reports" boolean DEFAULT false,
	"can_use_shipping" boolean DEFAULT false,
	"status" text DEFAULT 'active',
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "live_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"live_session_id" uuid,
	"external_comment_id" text,
	"tiktok_comment_id" text,
	"dedup_key" text,
	"tiktok_username" text,
	"tiktok_unique_id" text,
	"display_name" text,
	"avatar_url" text,
	"comment_text" text,
	"text" text,
	"raw_text" text,
	"intent" text DEFAULT 'normal',
	"priority_level" text DEFAULT 'normal',
	"final_score" real DEFAULT 0,
	"has_number" boolean DEFAULT false,
	"can_create_order" boolean DEFAULT false,
	"is_order_created" boolean DEFAULT false,
	"order_id" uuid,
	"raw_payload" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "live_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"created_by" text,
	"external_session_id" text,
	"tiktok_username" text,
	"started_at" timestamp,
	"ended_at" timestamp,
	"duration_seconds" integer DEFAULT 0,
	"comment_count" integer DEFAULT 0,
	"order_count" integer DEFAULT 0,
	"customer_count" integer DEFAULT 0,
	"status" text DEFAULT 'running',
	"end_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_code" text,
	"product_name" text,
	"variant_name" text,
	"color" text,
	"size" text,
	"quantity" integer DEFAULT 1,
	"price" real DEFAULT 0,
	"raw_comment_text" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"live_session_id" uuid,
	"customer_id" uuid,
	"live_comment_id" uuid,
	"order_code" text,
	"source" text DEFAULT 'live_comment',
	"customer_name" text,
	"customer_tiktok_username" text,
	"customer_phone" text,
	"customer_address" text,
	"comment_text" text,
	"color" text,
	"status" text DEFAULT 'draft',
	"deposit_status" text DEFAULT 'unpaid',
	"payment_status" text DEFAULT 'unpaid',
	"shipping_status" text DEFAULT 'not_shipped',
	"subtotal_amount" real DEFAULT 0,
	"shipping_fee" real DEFAULT 0,
	"discount_amount" real DEFAULT 0,
	"deposit_amount" real DEFAULT 0,
	"cod_amount" real DEFAULT 0,
	"total_amount" real DEFAULT 0,
	"currency" text DEFAULT 'VND',
	"note" text,
	"created_by" text,
	"confirmed_at" timestamp,
	"canceled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider" text DEFAULT 'manual',
	"payment_code" text,
	"plan_code" text,
	"months" integer DEFAULT 1,
	"amount" real DEFAULT 0,
	"currency" text DEFAULT 'VND',
	"status" text DEFAULT 'pending',
	"checkout_url" text,
	"paid_at" timestamp,
	"raw_payload" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text,
	"email" text,
	"phone" text,
	"avatar_url" text,
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shipping_providers" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shop_licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"status" text DEFAULT 'trial',
	"started_at" timestamp DEFAULT now(),
	"expired_at" timestamp,
	"trial_ends_at" timestamp,
	"is_current" boolean DEFAULT true,
	"max_orders_per_month" integer,
	"max_live_sessions_per_month" integer,
	"max_members" integer,
	"max_tiktok_accounts" integer,
	"price" real DEFAULT 0,
	"currency" text DEFAULT 'VND',
	"payment_status" text DEFAULT 'unpaid',
	"last_payment_at" timestamp,
	"note" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shop_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner',
	"status" text DEFAULT 'active',
	"invited_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shop_product_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"color" text,
	"price" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shop_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shop_shipping_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider_code" text NOT NULL,
	"is_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"default_tiktok_username" text,
	"status" text DEFAULT 'active',
	"license_status" text DEFAULT 'trial',
	"license_expired_at" timestamp,
	"trial_ends_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shop_tiktok_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"tiktok_username" text NOT NULL,
	"display_name" text,
	"is_default" boolean DEFAULT false,
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_live_session_id_live_sessions_id_fk" FOREIGN KEY ("live_session_id") REFERENCES "public"."live_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_live_session_id_live_sessions_id_fk" FOREIGN KEY ("live_session_id") REFERENCES "public"."live_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_code_license_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."license_plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_licenses" ADD CONSTRAINT "shop_licenses_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_licenses" ADD CONSTRAINT "shop_licenses_plan_code_license_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."license_plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_product_presets" ADD CONSTRAINT "shop_product_presets_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD CONSTRAINT "shop_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_shipping_providers" ADD CONSTRAINT "shop_shipping_providers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_shipping_providers" ADD CONSTRAINT "shop_shipping_providers_provider_code_shipping_providers_code_fk" FOREIGN KEY ("provider_code") REFERENCES "public"."shipping_providers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_tiktok_channels" ADD CONSTRAINT "shop_tiktok_channels_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "live_comments_shop_external_comment_id_unique" ON "live_comments" USING btree ("shop_id","external_comment_id");