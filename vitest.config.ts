import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@web/server": fileURLToPath(new URL("./web/server.tsx", import.meta.url)) },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
