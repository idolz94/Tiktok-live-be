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

  // JWT custom auth
  jwtSecret: readEnv("JWT_SECRET"),
  jwtRefreshSecret: readEnv("JWT_REFRESH_SECRET"),
  jwtAccessExpiresIn: readEnv("JWT_ACCESS_EXPIRES_IN", "15m"),
  jwtRefreshExpiresIn: readEnv("JWT_REFRESH_EXPIRES_IN", "30d"),

  // OAuth — Google
  googleClientId: readEnv("GOOGLE_CLIENT_ID"),
  googleClientSecret: readEnv("GOOGLE_CLIENT_SECRET"),
  googleCallbackUrl: readEnv("GOOGLE_CALLBACK_URL", "http://localhost:3001/api/auth/oauth/google/callback"),

  // OAuth — Facebook
  facebookAppId: readEnv("FACEBOOK_APP_ID"),
  facebookAppSecret: readEnv("FACEBOOK_APP_SECRET"),
  facebookCallbackUrl: readEnv("FACEBOOK_CALLBACK_URL", "http://localhost:3001/api/auth/oauth/facebook/callback"),

  trialDays: readNumberEnv("TRIAL_DAYS", 3),

  nodeInternalApiKey: readEnv("NODE_INTERNAL_API_KEY"),

  // Mobile app key
  mobileAppKey: readEnv("MOBILE_APP_KEY", "LUMI_APP_REACT_KEY"),

  // Payment
  paymentReturnUrl: readEnv("PAYMENT_RETURN_URL"),

  // SPX shipping
  spxAppId: readEnv("SPX_APP_ID"),
  spxAppSecret: readEnv("SPX_APP_SECRET"),
  spxApiBase: readEnv("SPX_API_BASE", "https://test-stable.spx.vn"),

  // EulerStream
  eulerApiKey: readEnv("EULER_API_KEY"),
  eulerApiBase: readEnv("EULER_API_BASE", "https://tiktok.eulerstream.com"),
};

export function assertRequiredEnv() {
  const missing = [
    ["DATABASE_URL", env.databaseUrl],
    ["JWT_SECRET", env.jwtSecret],
    ["JWT_REFRESH_SECRET", env.jwtRefreshSecret],
    ["NODE_INTERNAL_API_KEY", env.nodeInternalApiKey],
    ["EULER_API_KEY", env.eulerApiKey],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.map(([key]) => key).join(", ")}`);
  }
}
