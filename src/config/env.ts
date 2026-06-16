import dotenv from "dotenv";

dotenv.config();

function readEnv(key: string, fallback = "") {
  return process.env[key] ?? fallback;
}

function readNumberEnv(key: string, fallback: number) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

export const env = {
  nodeEnv: readEnv("NODE_ENV", "development"),
  port: readNumberEnv("PORT", 3001),
  clientOrigin: readEnv("CLIENT_ORIGIN", "http://localhost:3000"),

  // Neon Postgres
  databaseUrl: readEnv("DATABASE_URL"),

  // Clerk
  clerkSecretKey: readEnv("CLERK_SECRET_KEY"),
  clerkPublishableKey: readEnv("CLERK_PUBLISHABLE_KEY"),

  trialDays: readNumberEnv("TRIAL_DAYS", 365),
  defaultPlanCode: readEnv("DEFAULT_PLAN_CODE", "free"),

  // Internal API key — used by tiktok-collector service (in-process) is not needed here,
  // kept for any future external internal callers
  nodeInternalApiKey: readEnv("NODE_INTERNAL_API_KEY", "change_me"),

  // Mobile app key: React Native gửi header x-app-key để được phép gọi API
  mobileAppKey: readEnv("MOBILE_APP_KEY", "LUMI_APP_REACT_KEY"),

  // GHTK shipping
  ghtkApiBase: readEnv("OPEN_API_GHTK", "https://services-staging.ghtklab.com"),
  ghtkApiToken: readEnv("API_TOKEN_GHTK"),
  ghtkPartnerCode: readEnv("GHTK_PARTNER_CODE"),
};

export function assertRequiredEnv() {
  const missing = [
    ["DATABASE_URL", env.databaseUrl],
    ["CLERK_SECRET_KEY", env.clerkSecretKey],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.map(([key]) => key).join(", ")}`);
  }
}
