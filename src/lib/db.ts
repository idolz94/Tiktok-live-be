import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "../config/env.js";
import * as schema from "../db/schema/index.js";
import logger from "./logger.js";

const sql = neon(env.databaseUrl);

export const db = drizzle(sql, {
  schema,
  logger: {
    // ponytail: neon-http logger fires pre-execution — no elapsed available. Log in dev only.
    logQuery(query, params) {
      if (env.nodeEnv !== "production") {
        logger.debug({ query, params }, "[DB] query");
      }
    },
  },
});

export type DB = typeof db;
export type DbOrTx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];
