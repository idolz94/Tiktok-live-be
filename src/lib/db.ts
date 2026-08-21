import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../config/env.js";
import * as schema from "../db/schema/index.js";

// Postgres tự host (VM Linux) — dùng pg Pool, không dùng @neondatabase/serverless
const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  // VM nội bộ thường không bật SSL; nếu Postgres yêu cầu SSL thì đổi thành { rejectUnauthorized: false }
  // ssl: false,
});

pool.on("error", (err) => {
  console.error("[pg Pool error]", err);
});

export const db = drizzle(pool, { schema });

export type DB = typeof db;
export type DbOrTx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

// Để app có thể đóng pool khi shutdown (optional)
export { pool };
