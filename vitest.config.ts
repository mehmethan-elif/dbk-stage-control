import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    environment: "node"
  },
  resolve: {
    alias: {
      "@dbk/logger": path.resolve(__dirname, "packages/logger/src/index.ts"),
      "@dbk/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@dbk/protocol": path.resolve(__dirname, "packages/protocol/src/index.ts")
    }
  }
});
