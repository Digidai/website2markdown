/**
 * Contract between the Worker (src/) and the HeroUI front end (web/).
 *
 * This file is plain TypeScript with no DOM or Worker types so both
 * tsconfigs can import it. The Worker reaches the renderers through the
 * `@web/server` alias (wrangler.toml / vitest.config.ts), typed by
 * src/web-server.d.ts against these signatures.
 */

export type Lang = "en" | "zh";
export type SitePage = "home" | "examples" | "docs" | "integration";
export type ReaderMethod =
  | "native"
  | "fallback"
  | "browser"
  | "proxy"
  | "jina"
  | "firecrawl"
  | "cloudflare";

export interface WebRenderers {
  landingPageHTML(host: string, lang?: Lang, page?: SitePage): string;
  portalPageHTML(): string;
  loadingPageHTML(
    host: string,
    targetUrl: string,
    extraStreamParams: string,
    rawRequestPath?: string,
  ): string;
  renderedPageHTML(
    host: string,
    content: string,
    sourceUrl: string,
    tokenCount: string,
    method: ReaderMethod,
    cached?: boolean,
    articleTitle?: string,
    rawRequestPath?: string,
  ): string;
  errorPageHTML(title: string, message: string, statusCode?: number): string;
}

/** localStorage key used by HeroUI's useTheme hook. */
export const THEME_STORAGE_KEY = "heroui-theme";

/**
 * Runs in <head> before paint so the stored or system theme applies without
 * a flash. HeroUI reads `.dark` / `data-theme` on <html>.
 */
export const THEME_BOOT_SCRIPT =
  "(function(){try{var t=localStorage.getItem('heroui-theme')||'system';" +
  "if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';" +
  "var d=document.documentElement;d.classList.add(t);d.setAttribute('data-theme',t);}catch(e){}})();";
