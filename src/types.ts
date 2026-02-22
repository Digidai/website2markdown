export interface Env {
  MYBROWSER: Fetcher;
  CACHE_KV: KVNamespace;
  IMAGE_BUCKET: R2Bucket;
  API_TOKEN?: string;
  PUBLIC_API_TOKEN?: string;
  PAYWALL_RULES_JSON?: string;
  PAYWALL_RULES_KV_KEY?: string;
  /** Bright Data proxy URL: "username:password@host:port" */
  PROXY_URL?: string;
}

export type ConvertMethod =
  | "native"
  | "readability+turndown"
  | "browser+readability+turndown";

export type OutputFormat = "markdown" | "html" | "text" | "json";

export interface ExtractResult {
  html: string;
  images?: string[];
}

export interface SiteAdapter {
  /** Return true if this adapter handles the given URL. */
  match(url: string): boolean;
  /** Whether this site always needs browser rendering (skip static fetch). */
  alwaysBrowser: boolean;
  /** Configure browser page before navigation (UA, viewport, headers, response listeners). */
  configurePage(page: any, capturedImages?: Map<string, string>): Promise<void>;
  /** Extract content after navigation. Return null to fall back to default. */
  extract(page: any, capturedImages: Map<string, string>): Promise<ExtractResult | null>;
  /** Post-process HTML before Readability (optional). */
  postProcess?(html: string): string;
  /** Transform URL before browser navigation (optional). */
  transformUrl?(url: string): string;
  /** Fetch content directly via API, bypassing static fetch and browser. Return HTML or null. */
  fetchDirect?(url: string): Promise<string | null>;
}
