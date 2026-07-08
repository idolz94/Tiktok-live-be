import { createApp } from "../app.js";

export type TestServer = {
  baseUrl: string;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
};

// ponytail: origin header bypasses requireKnownClient for all test requests
const BASE_HEADERS = {
  "Content-Type": "application/json",
  origin: "http://localhost:3000",
};

export function startTestServer(): Promise<TestServer> {
  const app = createApp();

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not start test server"));
        return;
      }

      const baseUrl = `http://127.0.0.1:${address.port}`;

      resolve({
        baseUrl,
        fetch: (path, init = {}) =>
          fetch(`${baseUrl}${path}`, {
            ...init,
            headers: { ...BASE_HEADERS, ...(init.headers as Record<string, string>) },
          }),
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
