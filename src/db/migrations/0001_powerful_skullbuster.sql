CREATE TABLE "order_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider_code" text NOT NULL,
	"tracking_label" text,
	"external_order_id" text,
	"fee" integer,
	"status_code" text,
	"submitted_at" timestamp,
	"estimated_pick_time" text,
	"estimated_deliver_time" text,
	"raw_response" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shop_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"label" text,
	"name" text,
	"phone" text,
	"address" text,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "provider_code" text;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_addresses" ADD CONSTRAINT "shop_addresses_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;