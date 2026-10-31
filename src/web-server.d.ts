// The HeroUI front end lives in web/ with its own tsconfig (DOM + JSX).
// vitest aliases "@web/server" to web/server.tsx; wrangler to its Vite SSR build.
declare module "@web/server" {
  type R = import("../web/contract").WebRenderers;
  export const landingPageHTML: R["landingPageHTML"];
  export const portalPageHTML: R["portalPageHTML"];
  export const loadingPageHTML: R["loadingPageHTML"];
  export const renderedPageHTML: R["renderedPageHTML"];
  export const errorPageHTML: R["errorPageHTML"];
  export type SitePage = import("../web/contract").SitePage;
}
