CREATE TABLE "oauth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"email" text,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"provider_status_raw" text,
	"payload" jsonb,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"phone" text,
	"password_hash" text,
	"full_name" text,
	"avatar_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "profiles" CASCADE;--> statement-breakpoint
ALTER TABLE "customer_addresses" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_addresses" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "customer_addresses" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_addresses" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_addresses" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "customer_addresses" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "last_order_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "license_plans" ALTER COLUMN "price_monthly" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "license_plans" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "license_plans" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "license_plans" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "license_plans" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "license_plans" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "license_plans" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "live_comments" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "live_comments" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "live_comments" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "live_comments" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "live_comments" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "live_comments" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "live_sessions" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "live_sessions" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "live_sessions" ALTER COLUMN "ended_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "live_sessions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "live_sessions" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "live_sessions" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "live_sessions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "live_sessions" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "live_sessions" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_shipments" ALTER COLUMN "submitted_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_shipments" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_shipments" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "order_shipments" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_shipments" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_shipments" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "order_shipments" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "subtotal_amount" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "shipping_fee" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "discount_amount" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "deposit_amount" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "cod_amount" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "total_amount" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "created_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "confirmed_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "canceled_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "paid_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shipping_providers" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipping_providers" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shipping_providers" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shipping_providers" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipping_providers" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shipping_providers" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_addresses" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_addresses" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_addresses" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_addresses" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_addresses" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_addresses" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "started_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "started_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "expired_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "trial_ends_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "is_current" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "price" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "price" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "currency" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "payment_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "last_payment_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_licenses" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_members" ALTER COLUMN "user_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "shop_members" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_members" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_members" ALTER COLUMN "invited_by" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "shop_members" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_members" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_members" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_members" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_members" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_members" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_product_presets" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_product_presets" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_product_presets" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_product_presets" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_product_presets" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_product_presets" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_settings" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_settings" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_settings" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_settings" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_settings" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_settings" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_shipping_providers" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_shipping_providers" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_shipping_providers" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_shipping_providers" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_shipping_providers" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_shipping_providers" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "owner_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "license_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "license_expired_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "trial_ends_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_tiktok_channels" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_tiktok_channels" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_tiktok_channels" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_tiktok_channels" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_tiktok_channels" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_tiktok_channels" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "ward" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "tracking_code" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "tracking_link" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "shipping_fee" integer;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "cod_amount" integer;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "status" text DEFAULT 'submitted' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "status_raw" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "payment_side" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "label_url" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "label_format" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "label_paper_size" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "spx_tracking_no" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "service_type" smallint;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "collect_type" smallint;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "pickup_time" bigint;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "pickup_time_range_id" bigint;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "provider_shipping_fee" integer;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "parcel_weight_gram" integer;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "parcel_length_cm" integer;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "parcel_width_cm" integer;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "parcel_height_cm" integer;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "parcel_item_name" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "declared_value" integer;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "sender_name" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "sender_phone" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "sender_province" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "sender_district" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "sender_ward" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "sender_detail_address" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "receiver_name" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "receiver_phone" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "receiver_province" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "receiver_district" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "receiver_ward" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "receiver_detail_address" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "label_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_avatar_url" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_address_id" uuid;--> statement-breakpoint
ALTER TABLE "shop_addresses" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "shop_addresses" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "shop_addresses" ADD COLUMN "ward" text;--> statement-breakpoint
ALTER TABLE "shop_licenses" ADD COLUMN "activated_by" uuid;--> statement-breakpoint
ALTER TABLE "shop_shipping_providers" ADD COLUMN "api_token" text;--> statement-breakpoint
ALTER TABLE "shop_shipping_providers" ADD COLUMN "partner_code" text;--> statement-breakpoint
ALTER TABLE "shop_shipping_providers" ADD COLUMN "extra_config" jsonb;--> statement-breakpoint
ALTER TABLE "shop_shipping_providers" ADD COLUMN "environment" text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_tiktok_channels" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "shop_tiktok_channels" ADD COLUMN "follower_count" integer;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_order_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."order_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_accounts_provider_user_unique" ON "oauth_accounts" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "shipment_events_shipment_id_created_at_idx" ON "shipment_events" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE INDEX "shipment_events_order_id_created_at_idx" ON "shipment_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "shipment_events_shop_id_created_at_idx" ON "shipment_events" USING btree ("shop_id","created_at");--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_live_comment_id_live_comments_id_fk" FOREIGN KEY ("live_comment_id") REFERENCES "public"."live_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_address_id_customer_addresses_id_fk" FOREIGN KEY ("customer_address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_licenses" ADD CONSTRAINT "shop_licenses_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_code_unique" ON "orders" USING btree ("order_code");--> statement-breakpoint
CREATE INDEX "orders_shop_id_created_at_idx" ON "orders" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_members_shop_user_unique" ON "shop_members" USING btree ("shop_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_shipping_providers_shop_provider_unique" ON "shop_shipping_providers" USING btree ("shop_id","provider_code");