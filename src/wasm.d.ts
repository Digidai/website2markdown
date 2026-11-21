// Wrangler imports a .wasm file as a module compiled at deploy time (vitest.config.ts does the same).
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
