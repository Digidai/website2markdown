export interface Env {
  MYBROWSER: Fetcher;
  CACHE_KV: KVNamespace;
  IMAGE_BUCKET: R2Bucket;
  JOB_COORDINATOR?: DurableObjectNamespace;
  /** D1 database for auth, API keys, and usage metering */
  AUTH_DB?: D1Database;
  API_TOKEN?: string;
  PUBLIC_API_TOKEN?: string;
  PAYWALL_RULES_JSON?: string;
  PAYWALL_RULES_KV_KEY?: string;
  /** Bright Data proxy URL: "username:password@host:port" */
  PROXY_URL?: string;
  /** Optional proxy pool. Accepts comma/newline separated proxy URLs. */
  PROXY_POOL?: string;
  /** Cloudflare Account ID for REST API calls */
  CF_ACCOUNT_ID?: string;
  /** Cloudflare API Token with Browser Rendering - Edit permission */
  CF_API_TOKEN?: string;
  /** Resend API key for sending magic-link emails */
  RESEND_API_KEY?: string;
  /** From address for auth emails, e.g. "md.genedai.me <noreply@mail.genedai.me>" */
  AUTH_EMAIL_FROM?: string;
}

// ─── Auth & Tier Types ──────────────────────────────────────

export type Tier = "anonymous" | "free" | "pro";

export interface AuthContext {
  tier: Tier;
  accountId: string | null;
  keyId: string | null;
  quotaLimit: number;
  quotaUsed: number;
}

/**
 * PolicyDecision — computed from AuthContext, controls what resources
 * are available for this request. Downstream code only reads this.
 *
 *   resolveAuth() → AuthContext → buildPolicy() → PolicyDecision
 */
export interface PolicyDecision {
  tier: Tier;
  browserAllowed: boolean;
  proxyAllowed: boolean;
  engineSelectionAllowed: boolean;
  noCacheAllowed: boolean;
  quotaRemaining: number;
  /** Fixed credit cost for this request type (not actual path cost) */
  creditCost: number;
}

/** Quota limits per tier (credits per month) */
export const TIER_QUOTAS: Record<Tier, number> = {
  anonymous: 0,
  free: 1000,
  pro: 50000,
};

export type ConvertMethod =
  | "native"
  | "readability+turndown"
  | "browser+readability+turndown"
  | "jina"
  | "cf";

export type OutputFormat = "markdown" | "html" | "text" | "json";

export interface ExtractResult {
  html: string;
  images?: string[];
}

export type ExtractionStrategyType = "css" | "xpath" | "regex";
export type ExtractionFieldType = "text" | "html" | "attribute";

export type ExtractionErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_SCHEMA"
  | "INVALID_URL"
  | "UNSUPPORTED_STRATEGY"
  | "UNSUPPORTED_XPATH"
  | "EXTRACTION_TIMEOUT"
  | "EXTRACTION_FAILED"
  | "UPSTREAM_FETCH_FAILED";

export interface ExtractionError {
  code: ExtractionErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ExtractionFieldSchema {
  name: string;
  selector?: string;
  xpath?: string;
  type?: ExtractionFieldType;
  attribute?: string;
  multiple?: boolean;
  required?: boolean;
}

export interface StructuredExtractionSchema {
  name?: string;
  baseSelector?: string;
  baseXPath?: string;
  fields: ExtractionFieldSchema[];
}

export interface RegexExtractionSchema {
  patterns: Record<string, string>;
  flags?: string;
}

export type ExtractionSchema =
  | StructuredExtractionSchema
  | RegexExtractionSchema
  | Record<string, string>;

export interface ExtractionOptions {
  dedupe?: boolean;
  includeEmpty?: boolean;
  regexFlags?: string;
}

export interface ExtractionRequestInput {
  url?: string;
  html?: string;
}

export interface ExtractionRequestItem {
  strategy: ExtractionStrategyType;
  input?: ExtractionRequestInput;
  url?: string;
  html?: string;
  schema: ExtractionSchema;
  selector?: string;
  force_browser?: boolean;
  no_cache?: boolean;
  include_markdown?: boolean;
  options?: ExtractionOptions;
}

export interface ExtractionBatchRequest {
  items: ExtractionRequestItem[];
}

export interface ExtractionResultMeta {
  itemCount: number;
  matches: number;
  durationMs: number;
}

export interface ExtractionResult {
  success: boolean;
  strategy: ExtractionStrategyType;
  data: unknown;
  meta: ExtractionResultMeta;
  error?: ExtractionError;
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
