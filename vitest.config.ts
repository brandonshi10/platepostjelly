import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 15_000,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/convex/**"],
  },
});
