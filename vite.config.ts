import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Two builds of the HeroUI front end in web/:
//   vite build                         → web-dist/_app/* (browser bundle, served as static assets)
//   vite build --ssr web/server.tsx    → web-server-dist/server.js (imported by the Worker as "@web/server")
// The Worker bundle is built by wrangler, whose esbuild forces classic JSX, so
// it consumes the prebuilt server module instead of compiling web/*.tsx itself.
// Static assets get ETag revalidation, so fixed file names are fine.
export default defineConfig(({ isSsrBuild }) =>
  isSsrBuild
    ? {
        plugins: [react()],
        publicDir: false,
        build: {
          outDir: "web-server-dist",
          emptyOutDir: true,
          rollupOptions: { output: { entryFileNames: "server.js" } },
        },
      }
    : {
        plugins: [react(), tailwindcss()],
        publicDir: false,
        build: {
          outDir: "web-dist",
          emptyOutDir: true,
          assetsDir: "_app",
          cssCodeSplit: false,
          chunkSizeWarningLimit: 1024,
          rollupOptions: {
            input: "web/client.tsx",
            output: {
              entryFileNames: "_app/app.js",
              chunkFileNames: "_app/[name].js",
              assetFileNames: "_app/app[extname]",
            },
          },
        },
      },
);
