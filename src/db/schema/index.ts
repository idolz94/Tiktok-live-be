import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";

// ─── users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  email: text("email").unique(),
  phone: text("phone").unique(),
  passwordHash: text("password_hash"),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("user"), // user | admin | manager
  status: text("status").notNull().default("active"),
  spxUserId: bigint("spx_user_id", { mode: "number" }),
  spxUserSecret: text("spx_user_secret"),
  facebookUrl: text("facebook_url"),
  tiktokUrl: text("tiktok_url"),
  youtubeUrl: text("youtube_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── oauth_accounts ───────────────────────────────────────────────────────────
export const oauthAccounts = pgTable("oauth_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerUserId: text("provider_user_id").notNull(),
  email: text("email"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("oauth_accounts_provider_user_unique").on(table.provider, table.providerUserId),
]);

// ─── refresh_tokens ───────────────────────────────────────────────────────────
export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── shops ────────────────────────────────────────────────────────────────────
export const shops = pgTable("shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  phone: text("phone"),
  defaultTikTokUsername: text("default_tiktok_username"),
  status: text("status").notNull().default("active"),
  licenseStatus: text("license_status").notNull().default("trial"),
  licenseExpiredAt: timestamp("license_expired_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── shop_members ─────────────────────────────────────────────────────────────
export const shopMembers = pgTable("shop_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("owner"),
  status: text("status").notNull().default("active"),
  invitedBy: uuid("invited_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("shop_members_shop_user_unique").on(table.shopId, table.userId),
]);

// ─── license_plans ────────────────────────────────────────────────────────────
export const licensePlans = pgTable("license_plans", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  priceMonthly: integer("price_monthly").default(0),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── shop_licenses ────────────────────────────────────────────────────────────
export const shopLicenses = pgTable("shop_licenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  planCode: text("plan_code").notNull().references(() => licensePlans.code),
  status: text("status").notNull().default("trial"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiredAt: timestamp("expired_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  isCurrent: boolean("is_current").notNull().default(true),
  maxOrdersPerMonth: integer("max_orders_per_month"),
  maxLiveSessionsPerMonth: integer("max_live_sessions_per_month"),
  maxMembers: integer("max_members"),
  maxTiktokAccounts: integer("max_tiktok_accounts"),
  price: integer("price").notNull().default(0),
  currency: text("currency").notNull().default("VND"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  lastPaymentAt: timestamp("last_payment_at", { withTimezone: true }),
  activatedBy: uuid("activated_by").references(() => users.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── shop_tiktok_channels ─────────────────────────────────────────────────────
export const tiktokChannels = pgTable("shop_tiktok_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  tiktokUsername: text("tiktok_username").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  followerCount: integer("follower_count"),
  isDefault: boolean("is_default").default(false),
  status: text("status").default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tiktok_channels_shop_username_unique").on(table.shopId, table.tiktokUsername),
]);

// ─── live_sessions ────────────────────────────────────────────────────────────
export const liveSessions = pgTable("live_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id),
  externalSessionId: text("external_session_id"),
  tiktokUsername: text("tiktok_username"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds").default(0),
  commentCount: integer("comment_count").default(0),
  orderCount: integer("order_count").default(0),
  customerCount: integer("customer_count").default(0),
  status: text("status").default("running"),
  endReason: text("end_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("live_sessions_shop_id_created_at_idx").on(table.shopId, table.createdAt),
]);

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
  totalSpent: integer("total_spent").default(0),
  lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
  status: text("status").default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("customers_shop_tiktok_username_unique").on(table.shopId, table.tiktokUsername),
]);

// ─── shop_addresses ───────────────────────────────────────────────────────────
export const shopAddresses = pgTable("shop_addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  label: text("label"),
  name: text("name"),
  phone: text("phone"),
  address: text("address"),
  province: text("province"),
  district: text("district"),
  ward: text("ward"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── customer_addresses ───────────────────────────────────────────────────────
export const customerAddresses = pgTable("customer_addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  label: text("label"),
  name: text("name"),
  phone: text("phone"),
  address: text("address"),
  province: text("province"),
  district: text("district"),
  ward: text("ward"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── orders ───────────────────────────────────────────────────────────────────
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  liveSessionId: uuid("live_session_id").references(() => liveSessions.id),
  customerId: uuid("customer_id").references(() => customers.id),
  liveCommentId: uuid("live_comment_id").references(() => liveComments.id, { onDelete: "set null" }),
  orderCode: text("order_code"),
  source: text("source").default("live_comment"),
  customerName: text("customer_name"),
  customerTiktokUsername: text("customer_tiktok_username"),
  customerPhone: text("customer_phone"),
  customerAddress: text("customer_address"),
  customerAvatarUrl: text("customer_avatar_url"),
  customerAddressId: uuid("customer_address_id").references(() => customerAddresses.id, { onDelete: "set null" }),
  commentText: text("comment_text"),
  color: text("color"),
  status: text("status").default("draft"),
  depositStatus: text("deposit_status").default("unpaid"),
  paymentStatus: text("payment_status").default("unpaid"),
  shippingStatus: text("shipping_status").default("not_shipped"),
  subtotalAmount: integer("subtotal_amount").default(0),
  shippingFee: integer("shipping_fee").default(0),
  discountAmount: integer("discount_amount").default(0),
  depositAmount: integer("deposit_amount").default(0),
  codAmount: integer("cod_amount").default(0),
  totalAmount: integer("total_amount").default(0),
  currency: text("currency").default("VND"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  providerCode: text("provider_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("orders_order_code_unique").on(table.orderCode),
  index("orders_shop_id_created_at_idx").on(table.shopId, table.createdAt),
]);

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
  price: integer("price").default(0),
  rawCommentText: text("raw_comment_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("order_items_order_id_idx").on(table.orderId),
]);

// ─── order_shipments ─────────────────────────────────────────────────────────
export const orderShipments = pgTable("order_shipments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  providerCode: text("provider_code").notNull(),
  trackingLabel: text("tracking_label"),
  trackingCode: text("tracking_code"),
  trackingLink: text("tracking_link"),
  externalOrderId: text("external_order_id"),
  fee: integer("fee"),
  shippingFee: integer("shipping_fee"),
  codAmount: integer("cod_amount"),
  status: text("status").default("submitted").notNull(),
  statusCode: text("status_code"),
  statusRaw: text("status_raw"),
  paymentSide: text("payment_side"),
  labelUrl: text("label_url"),
  labelFormat: text("label_format"),
  labelPaperSize: text("label_paper_size"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  estimatedPickTime: text("estimated_pick_time"),
  estimatedDeliverTime: text("estimated_deliver_time"),
  rawResponse: jsonb("raw_response"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // SPX-specific fields
  spxTrackingNo: text("spx_tracking_no"),
  serviceType: smallint("service_type"),
  collectType: smallint("collect_type"),
  pickupTime: bigint("pickup_time", { mode: "number" }),
  pickupTimeRangeId: bigint("pickup_time_range_id", { mode: "number" }),
  providerShippingFee: integer("provider_shipping_fee"),
  parcelWeightGram: integer("parcel_weight_gram"),
  parcelLengthCm: integer("parcel_length_cm"),
  parcelWidthCm: integer("parcel_width_cm"),
  parcelHeightCm: integer("parcel_height_cm"),
  parcelItemName: text("parcel_item_name"),
  declaredValue: integer("declared_value"),
  senderName: text("sender_name"),
  senderPhone: text("sender_phone"),
  senderProvince: text("sender_province"),
  senderDistrict: text("sender_district"),
  senderWard: text("sender_ward"),
  senderDetailAddress: text("sender_detail_address"),
  receiverName: text("receiver_name"),
  receiverPhone: text("receiver_phone"),
  receiverProvince: text("receiver_province"),
  receiverDistrict: text("receiver_district"),
  receiverWard: text("receiver_ward"),
  receiverDetailAddress: text("receiver_detail_address"),
  labelExpiresAt: timestamp("label_expires_at", { withTimezone: true }),
  idempotencyKey: text("idempotency_key"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
});

// ─── shipment_events ──────────────────────────────────────────────────────────
export const shipmentEvents = pgTable("shipment_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id").notNull().references(() => orderShipments.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  providerStatusRaw: text("provider_status_raw"),
  payload: jsonb("payload"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("shipment_events_shipment_id_created_at_idx").on(table.shipmentId, table.createdAt),
  index("shipment_events_order_id_created_at_idx").on(table.orderId, table.createdAt),
  index("shipment_events_shop_id_created_at_idx").on(table.shopId, table.createdAt),
]);

// ─── live_comments ────────────────────────────────────────────────────────────


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
  commentText: text("comment_text"),  // canonical write target — use this
  text: text("text"),                  // legacy alias, kept for migration safety; reads fall back via getCommentText()
  rawText: text("raw_text"),           // raw collector payload text before normalization
  intent: text("intent").default("normal"),
  priorityLevel: text("priority_level").default("normal"),
  finalScore: real("final_score").default(0),
  hasNumber: boolean("has_number").default(false),
  canCreateOrder: boolean("can_create_order").default(false),
  isOrderCreated: boolean("is_order_created").default(false),
  orderId: uuid("order_id"),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("live_comments_session_external_comment_id_unique").on(table.liveSessionId, table.externalCommentId),
]);

// ─── payments ─────────────────────────────────────────────────────────────────
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  provider: text("provider").default("manual"),
  paymentCode: text("payment_code"),
  planCode: text("plan_code").references(() => licensePlans.code),
  months: integer("months").default(1),
  amount: integer("amount").default(0),
  currency: text("currency").default("VND"),
  status: text("status").default("pending"),
  checkoutUrl: text("checkout_url"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── shop_settings ────────────────────────────────────────────────────────────
export const shopSettings = pgTable("shop_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: jsonb("value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── shipping_providers ───────────────────────────────────────────────────────
export const shippingProviders = pgTable("shipping_providers", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  status: text("status").default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── shop_shipping_providers ──────────────────────────────────────────────────
export const shopShippingProviders = pgTable("shop_shipping_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  providerCode: text("provider_code").notNull().references(() => shippingProviders.code),
  isEnabled: boolean("is_enabled").default(true),
  apiToken: text("api_token"),
  partnerCode: text("partner_code"),
  extraConfig: jsonb("extra_config"),
  environment: text("environment").notNull().default("production"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("shop_shipping_providers_shop_provider_unique").on(table.shopId, table.providerCode),
]);

// ─── shop_product_presets ─────────────────────────────────────────────────────
export const shopProductPresets = pgTable("shop_product_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name"),
  color: text("color"),
  price: integer("price").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
