import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.vitest.ts"],
    environment: "edge-runtime",
    fileParallelism: false,
    testTimeout: 10_000,
  },
});
