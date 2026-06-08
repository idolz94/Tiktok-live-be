import dotenv from "dotenv";

dotenv.config();

function readEnv(key: string, fallback = "") {
  return process.env[key] ?? fallback;
}

function readNumberEnv(key: string, fallback: number) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function readBooleanEnv(key: string, fallback = false) {
  const value = String(process.env[key] ?? "").toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

export const env = {
  nodeEnv: readEnv("NODE_ENV", "development"),
  port: readNumberEnv("PORT", 3001),
  clientOrigin: readEnv("CLIENT_ORIGIN", "http://localhost:3000"),
  supabaseUrl: readEnv("SUPABASE_URL"),
  supabaseAnonKey: readEnv("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY"),
  authCookieName: readEnv("AUTH_COOKIE_NAME", "lumi_access_token"),
  trialDays: readNumberEnv("TRIAL_DAYS", 365),
  defaultPlanCode: readEnv("DEFAULT_PLAN_CODE", "free"),
  redisUrl: readEnv("REDIS_URL", "redis://localhost:6379"),
  enableRedis: readBooleanEnv("ENABLE_REDIS", false),
  paymentProvider: readEnv("PAYMENT_PROVIDER", "manual"),
  paymentReturnUrl: readEnv("PAYMENT_RETURN_URL", "http://localhost:3000/settings/license"),
  paymentWebhookSecret: readEnv("PAYMENT_WEBHOOK_SECRET", "change_me"),

  // Internal channel: Python TikTok Collector -> Node.js Backend
  nodeInternalApiKey: readEnv("NODE_INTERNAL_API_KEY", "change_me"),

  // Mobile app key: React Native gửi header x-app-key để được phép gọi API
  mobileAppKey: readEnv("MOBILE_APP_KEY", ""),

  // Optional control channel: Node.js Backend -> Python TikTok Collector
  pythonCollectorBaseUrl: readEnv("PYTHON_COLLECTOR_BASE_URL", "http://localhost:8765"),
  collectorControlApiKey: readEnv("COLLECTOR_CONTROL_API_KEY", "change_me"),
};

export function assertRequiredEnv() {
  const missing = [
    ["SUPABASE_URL", env.supabaseUrl],
    ["SUPABASE_ANON_KEY", env.supabaseAnonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", env.supabaseServiceRoleKey],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.map(([key]) => key).join(", ")}`);
  }
}
