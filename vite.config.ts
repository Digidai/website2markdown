import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Two builds of the HeroUI front end in web/:
//   vite build                         → web-dist/_app/* (browser bundles, served as static assets)
//   vite build --ssr web/server.tsx    → web-server-dist/server.js (imported by the Worker as "@web/server")
// The Worker bundle is built by wrangler, whose esbuild forces classic JSX, so
// it consumes the prebuilt server module instead of compiling web/*.tsx itself.
// Static assets get ETag revalidation, so fixed entry file names are fine.
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
            // One entry per page family; shared code is split into common chunks.
            input: {
              landing: "web/entries/landing.tsx",
              portal: "web/entries/portal.tsx",
              reader: "web/entries/reader.tsx",
              admin: "web/entries/admin.tsx",
            },
            output: {
              entryFileNames: "_app/[name].js",
              chunkFileNames: "_app/[name]-[hash].js",
              assetFileNames: "_app/app[extname]",
            },
          },
        },
      },
);
