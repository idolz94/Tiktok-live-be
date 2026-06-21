import express from "express";
import cookieParser from "cookie-parser";
import { afterEach, describe, expect, it } from "vitest";
import authRoutes from "./auth.routes.js";
import { errorHandler } from "../middlewares/error.js";

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoutes);
  app.use(errorHandler);

  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to start test server"));
        return;
      }

      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

describe("auth refresh route", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("returns a stable 401 response when the refresh cookie is missing", async () => {
    const server = await createTestServer();
    servers.push(server);

    const response = await fetch(`${server.baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "Refresh token không tồn tại.",
      code: "UNAUTHORIZED",
    });
    expect(response.status).toBe(401);
  });
});
