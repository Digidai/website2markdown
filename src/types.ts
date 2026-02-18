export interface Env {
  MYBROWSER: Fetcher;
  CACHE_KV: KVNamespace;
  IMAGE_BUCKET: R2Bucket;
  API_TOKEN?: string;
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
}
