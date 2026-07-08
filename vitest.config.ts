import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/tests/setup.ts"],
  },
  resolve: {
    // Allow imports with .js extension to resolve .ts files (NodeNext pattern)
    extensions: [".ts", ".js"],
  },
});
