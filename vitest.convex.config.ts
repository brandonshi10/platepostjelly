import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/convex/**/*.test.ts"],
    pool: "threads",
    isolate: true,
  },
});
