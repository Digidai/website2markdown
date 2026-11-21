import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      // Wrangler imports a .wasm file as a compiled WebAssembly.Module; load it the same way here.
      name: "wasm-module",
      enforce: "pre",
      load(id) {
        if (!id.endsWith(".wasm")) return null;
        return `import { readFileSync } from "node:fs"; export default new WebAssembly.Module(readFileSync(${JSON.stringify(id)}));`;
      },
    },
  ],
  resolve: {
    alias: { "@web/server": fileURLToPath(new URL("./web/server.tsx", import.meta.url)) },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    // Inlined so its .wasm import goes through the plugin above, not Node's own loader.
    server: { deps: { inline: ["@ai-ecoverse/wasm-tls-engine"] } },
  },
});
