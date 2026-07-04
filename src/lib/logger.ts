import pino from "pino";
import { env } from "../config/env.js";

const logger = pino({ level: env.nodeEnv === "production" ? "info" : "debug" });

export default logger;
