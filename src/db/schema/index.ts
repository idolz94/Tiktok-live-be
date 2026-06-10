import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─── profiles ────────────────────────────────────────────────────────────────
export const profiles = pgTable("profiles", {
  id: text("id").primaryKey(), // Clerk user id (user_2abc…)
  fullName: text("full_name"),
  email: text("email"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── shops ────────────────────────────────────────────────────────────────────
export const shops = pgTable("shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(), // Clerk user id
  name: text("name").notNull(),
  phone: text("phone"),
  defaultTikTokUsername: text("default_tiktok_username"),
  status: text("status").default("active"),
  licenseStatus: text("license_status").default("trial"),
  licenseExpiredAt: timestamp("license_expired_at"),
  trialEndsAt: timestamp("trial_ends_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── shop_members ─────────────────────────────────────────────────────────────
export const shopMembers = pgTable("shop_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(), // Clerk user id
  role: text("role").default("owner"),
  status: text("status").default("active"),
  invitedBy: text("invited_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── license_plans ────────────────────────────────────────────────────────────
export const licensePlans = pgTable("license_plans", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  priceMonthly: real("price_monthly").default(0),
  maxOrdersPerMonth: integer("max_orders_per_month"),
  maxLiveSessionsPerMonth: integer("max_live_sessions_per_month"),
  maxMembers: integer("max_members"),
  maxTiktokAccounts: integer("max_tiktok_accounts"),
  canPrint: boolean("can_print").default(false),
  canExportExcel: boolean("can_export_excel").default(false),
  canUseReports: boolean("can_use_reports").default(false),
  canUseShipping: boolean("can_use_shipping").default(false),
  status: text("status").default("active"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── shop_licenses ────────────────────────────────────────────────────────────
export const shopLicenses = pgTable("shop_licenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  planCode: text("plan_code").notNull().references(() => licensePlans.code),
  status: text("status").default("trial"),
  startedAt: timestamp("started_at").defaultNow(),
  expiredAt: timestamp("expired_at"),
  trialEndsAt: timestamp("trial_ends_at"),
  isCurrent: boolean("is_current").default(true),
  maxOrdersPerMonth: integer("max_orders_per_month"),
  maxLiveSessionsPerMonth: integer("max_live_sessions_per_month"),
  maxMembers: integer("max_members"),
  maxTiktokAccounts: integer("max_tiktok_accounts"),
  price: real("price").default(0),
  currency: text("currency").default("VND"),
  paymentStatus: text("payment_status").default("unpaid"),
  lastPaymentAt: timestamp("last_payment_at"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── shop_tiktok_channels ─────────────────────────────────────────────────────
export const tiktokChannels = pgTable("shop_tiktok_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  tiktokUsername: text("tiktok_username").notNull(),
  displayName: text("display_name"),
  isDefault: boolean("is_default").default(false),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── live_sessions ────────────────────────────────────────────────────────────
export const liveSessions = pgTable("live_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  createdBy: text("created_by"),
  externalSessionId: text("external_session_id"),
  tiktokUsername: text("tiktok_username"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  durationSeconds: integer("duration_seconds").default(0),
  commentCount: integer("comment_count").default(0),
  orderCount: integer("order_count").default(0),
  customerCount: integer("customer_count").default(0),
  status: text("status").default("running"),
  endReason: text("end_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── customers ────────────────────────────────────────────────────────────────
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  tiktokUsername: text("tiktok_username"),
  tiktokUniqueId: text("tiktok_unique_id"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  phone: text("phone"),
  address: text("address"),
  shippingAddress: text("shipping_address"),
  customerType: text("customer_type"),
  referenceInfo: text("reference_info"),
  note: text("note"),
  tags: jsonb("tags").default([]),
  totalOrders: integer("total_orders").default(0),
  totalSpent: real("total_spent").default(0),
  lastOrderAt: timestamp("last_order_at"),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── customer_addresses ───────────────────────────────────────────────────────
export const customerAddresses = pgTable("customer_addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  label: text("label"),
  phone: text("phone"),
  address: text("address"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── orders ───────────────────────────────────────────────────────────────────
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  liveSessionId: uuid("live_session_id").references(() => liveSessions.id),
  customerId: uuid("customer_id").references(() => customers.id),
  liveCommentId: uuid("live_comment_id"), // set after liveComments insert
  orderCode: text("order_code"),
  source: text("source").default("live_comment"),
  customerName: text("customer_name"),
  customerTiktokUsername: text("customer_tiktok_username"),
  customerPhone: text("customer_phone"),
  customerAddress: text("customer_address"),
  commentText: text("comment_text"),
  status: text("status").default("draft"),
  depositStatus: text("deposit_status").default("unpaid"),
  paymentStatus: text("payment_status").default("unpaid"),
  shippingStatus: text("shipping_status").default("not_shipped"),
  subtotalAmount: real("subtotal_amount").default(0),
  shippingFee: real("shipping_fee").default(0),
  discountAmount: real("discount_amount").default(0),
  depositAmount: real("deposit_amount").default(0),
  codAmount: real("cod_amount").default(0),
  totalAmount: real("total_amount").default(0),
  currency: text("currency").default("VND"),
  note: text("note"),
  createdBy: text("created_by"),
  confirmedAt: timestamp("confirmed_at"),
  canceledAt: timestamp("canceled_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── order_items ──────────────────────────────────────────────────────────────
export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  productCode: text("product_code"),
  productName: text("product_name"),
  variantName: text("variant_name"),
  color: text("color"),
  size: text("size"),
  quantity: integer("quantity").default(1),
  price: real("price").default(0),
  rawCommentText: text("raw_comment_text"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── live_comments ────────────────────────────────────────────────────────────
export const liveComments = pgTable("live_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  liveSessionId: uuid("live_session_id").references(() => liveSessions.id),
  externalCommentId: text("external_comment_id"),
  tiktokCommentId: text("tiktok_comment_id"),
  dedupKey: text("dedup_key"),
  tiktokUsername: text("tiktok_username"),
  tiktokUniqueId: text("tiktok_unique_id"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  commentText: text("comment_text"),
  text: text("text"),
  rawText: text("raw_text"),
  intent: text("intent").default("normal"),
  priorityLevel: text("priority_level").default("normal"),
  finalScore: real("final_score").default(0),
  hasNumber: boolean("has_number").default(false),
  canCreateOrder: boolean("can_create_order").default(false),
  isOrderCreated: boolean("is_order_created").default(false),
  orderId: uuid("order_id"),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("live_comments_shop_external_comment_id_unique").on(table.shopId, table.externalCommentId),
]);

// ─── payments ─────────────────────────────────────────────────────────────────
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  provider: text("provider").default("manual"),
  paymentCode: text("payment_code"),
  planCode: text("plan_code").references(() => licensePlans.code),
  months: integer("months").default(1),
  amount: real("amount").default(0),
  currency: text("currency").default("VND"),
  status: text("status").default("pending"),
  checkoutUrl: text("checkout_url"),
  paidAt: timestamp("paid_at"),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── shop_settings ────────────────────────────────────────────────────────────
export const shopSettings = pgTable("shop_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: jsonb("value"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── shipping_providers ───────────────────────────────────────────────────────
export const shippingProviders = pgTable("shipping_providers", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── shop_shipping_providers ──────────────────────────────────────────────────
export const shopShippingProviders = pgTable("shop_shipping_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  providerCode: text("provider_code").notNull().references(() => shippingProviders.code),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
