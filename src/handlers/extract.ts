// 提取处理

import type {
  Env,
  ExtractionErrorCode,
  ExtractionOptions,
  ExtractionRequestItem,
  ExtractionSchema,
  ExtractionStrategyType,
} from "../types";
import {
  CORS_HEADERS,
  MAX_RESPONSE_BYTES,
  MAX_SELECTOR_LENGTH,
  BROWSER_CONCURRENCY,
} from "../config";
import { isSafeUrl, isValidUrl } from "../security";
import { htmlToMarkdown } from "../converter";
import {
  extractWithStrategy,
  ExtractionStrategyError,
} from "../extraction/strategies";
import { logMetric } from "../runtime-state";
import { ConvertError } from "../helpers/response";
import { timingSafeEqual } from "../middleware/auth";
import { errorMessage } from "../utils";
import {
  convertUrlWithMetrics,
  readBodyWithLimit,
  BodyTooLargeError,
} from "./convert";
import { pLimit } from "./batch";

const EXTRACT_BODY_MAX_BYTES = 1_000_000;
const MAX_EXTRACT_BATCH_ITEMS = 10;
const VALID_EXTRACTION_STRATEGIES = new Set<ExtractionStrategyType>([
  "css",
  "xpath",
  "regex",
]);
const MAX_REGEX_FLAGS_LENGTH = 8;
const VALID_REGEX_FLAGS = new Set(["d", "g", "i", "m", "s", "u", "y"]);

// ─── 类型定义 ────────────────────────────────────────────────

export interface ExtractNormalizedItem {
  strategy: ExtractionStrategyType;
  schema: ExtractionSchema;
  options?: ExtractionOptions;
  url?: string;
  html?: string;
  selector?: string;
  forceBrowser: boolean;
  noCache: boolean;
  includeMarkdown: boolean;
}

interface NormalizedExtractPayload {
  isBatch: boolean;
  items: ExtractNormalizedItem[];
}

interface ExtractResultError {
  code: ExtractionErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ─── 辅助函数 ────────────────────────────────────────────────

export function extractErrorResponse(
  error: ExtractResultError,
  status: number = 400,
): Response {
  return Response.json(
    {
      error: "Invalid request",
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
    { status, headers: CORS_HEADERS },
  );
}

export function normalizeExtractItem(input: unknown): { item?: ExtractNormalizedItem; error?: ExtractResultError } {
  if (!input || typeof input !== "object") {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: "Extraction item must be an object.",
      },
    };
  }

  const raw = input as Partial<ExtractionRequestItem> & { [key: string]: unknown };
  const sourceInput = (raw.input && typeof raw.input === "object")
    ? raw.input as { url?: unknown; html?: unknown }
    : undefined;

  const strategy = raw.strategy;
  if (!strategy || typeof strategy !== "string" || !VALID_EXTRACTION_STRATEGIES.has(strategy as ExtractionStrategyType)) {
    return {
      error: {
        code: "UNSUPPORTED_STRATEGY",
        message: "strategy must be one of: css, xpath, regex.",
      },
    };
  }

  const schema = raw.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return {
      error: {
        code: "INVALID_SCHEMA",
        message: "schema must be an object.",
      },
    };
  }

  const url = typeof raw.url === "string"
    ? raw.url
    : typeof sourceInput?.url === "string"
      ? sourceInput.url
      : undefined;
  const html = typeof raw.html === "string"
    ? raw.html
    : typeof sourceInput?.html === "string"
      ? sourceInput.html
      : undefined;

  if (!url && !html) {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: "Either url or html input is required.",
      },
    };
  }

  if (url && (!isValidUrl(url) || !isSafeUrl(url))) {
    return {
      error: {
        code: "INVALID_URL",
        message: "url is invalid or blocked by SSRF rules.",
        details: { url },
      },
    };
  }

  if (html) {
    const bytes = new TextEncoder().encode(html).byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: `html input exceeds max size (${MAX_RESPONSE_BYTES} bytes).`,
          details: { bytes, max: MAX_RESPONSE_BYTES },
        },
      };
    }
  }

  const selector = typeof raw.selector === "string" ? raw.selector : undefined;
  if (selector && selector.length > MAX_SELECTOR_LENGTH) {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: `selector is too long (max ${MAX_SELECTOR_LENGTH} characters).`,
      },
    };
  }

  const forceBrowser = raw.force_browser === true;
  const noCache = raw.no_cache === true;
  const includeMarkdown = raw.include_markdown === true;
  const normalizedOptions = normalizeExtractionOptions(raw.options);
  if (normalizedOptions.error) {
    return { error: normalizedOptions.error };
  }
  const options = normalizedOptions.options;

  return {
    item: {
      strategy: strategy as ExtractionStrategyType,
      schema: schema as ExtractionSchema,
      options,
      url,
      html,
      selector,
      forceBrowser,
      noCache,
      includeMarkdown,
    },
  };
}

function normalizeExtractionOptions(
  value: unknown,
): { options?: ExtractionOptions; error?: ExtractResultError } {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: "options must be an object when provided.",
      },
    };
  }
  const raw = value as Record<string, unknown>;
  const allowedKeys = new Set(["dedupe", "includeEmpty", "regexFlags"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: `options.${key} is not supported.`,
        },
      };
    }
  }

  const normalized: ExtractionOptions = {};
  if (raw.dedupe !== undefined) {
    if (typeof raw.dedupe !== "boolean") {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: "options.dedupe must be a boolean.",
        },
      };
    }
    normalized.dedupe = raw.dedupe;
  }
  if (raw.includeEmpty !== undefined) {
    if (typeof raw.includeEmpty !== "boolean") {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: "options.includeEmpty must be a boolean.",
        },
      };
    }
    normalized.includeEmpty = raw.includeEmpty;
  }
  if (raw.regexFlags !== undefined) {
    if (typeof raw.regexFlags !== "string") {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: "options.regexFlags must be a string.",
        },
      };
    }
    const flags = raw.regexFlags.trim();
    if (!flags) {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: "options.regexFlags cannot be empty when provided.",
        },
      };
    }
    if (flags.length > MAX_REGEX_FLAGS_LENGTH) {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: `options.regexFlags is too long (max ${MAX_REGEX_FLAGS_LENGTH} characters).`,
        },
      };
    }
    const seen = new Set<string>();
    for (const flag of flags) {
      if (!VALID_REGEX_FLAGS.has(flag)) {
        return {
          error: {
            code: "INVALID_REQUEST",
            message: `options.regexFlags contains unsupported flag "${flag}".`,
          },
        };
      }
      if (seen.has(flag)) {
        return {
          error: {
            code: "INVALID_REQUEST",
            message: `options.regexFlags contains duplicate flag "${flag}".`,
          },
        };
      }
      seen.add(flag);
    }
    normalized.regexFlags = flags;
  }
  return Object.keys(normalized).length > 0 ? { options: normalized } : {};
}

function normalizeExtractPayload(input: unknown): { payload?: NormalizedExtractPayload; error?: ExtractResultError } {
  if (!input || typeof input !== "object") {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: "Request body must be a JSON object.",
      },
    };
  }

  const body = input as { items?: unknown[] };
  if (Array.isArray(body.items)) {
    if (body.items.length === 0) {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: "items cannot be empty.",
        },
      };
    }
    if (body.items.length > MAX_EXTRACT_BATCH_ITEMS) {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: `Maximum ${MAX_EXTRACT_BATCH_ITEMS} items per extraction batch.`,
        },
      };
    }
    const items: ExtractNormalizedItem[] = [];
    for (let i = 0; i < body.items.length; i++) {
      const normalized = normalizeExtractItem(body.items[i]);
      if (normalized.error) {
        return {
          error: {
            ...normalized.error,
            details: {
              ...(normalized.error.details || {}),
              index: i,
            },
          },
        };
      }
      items.push(normalized.item!);
    }
    return {
      payload: {
        isBatch: true,
        items,
      },
    };
  }

  const single = normalizeExtractItem(body);
  if (single.error) return { error: single.error };
  return {
    payload: {
      isBatch: false,
      items: [single.item!],
    },
  };
}

// ─── 主处理函数 ──────────────────────────────────────────────

export async function handleExtract(
  request: Request,
  env: Env,
  host: string,
): Promise<Response> {
  // Require API_TOKEN for extraction API.
  if (!env.API_TOKEN) {
    return Response.json(
      {
        error: "Service misconfigured",
        code: "INVALID_REQUEST",
        message: "API_TOKEN not set",
      },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || !(await timingSafeEqual(auth.slice(7), env.API_TOKEN))) {
    return Response.json(
      {
        error: "Unauthorized",
        code: "INVALID_REQUEST",
        message: "Valid Bearer token required",
      },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > EXTRACT_BODY_MAX_BYTES) {
    return Response.json(
      {
        error: "Request too large",
        code: "INVALID_REQUEST",
        message: `Maximum body size is ${EXTRACT_BODY_MAX_BYTES} bytes`,
      },
      { status: 413, headers: CORS_HEADERS },
    );
  }

  let body: unknown;
  try {
    const bodyBytes = await readBodyWithLimit(
      request.body,
      EXTRACT_BODY_MAX_BYTES,
      `Maximum body size is ${EXTRACT_BODY_MAX_BYTES} bytes`,
      request.signal,
    );
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return Response.json(
        {
          error: "Request too large",
          code: "INVALID_REQUEST",
          message: `Maximum body size is ${EXTRACT_BODY_MAX_BYTES} bytes`,
        },
        { status: 413, headers: CORS_HEADERS },
      );
    }
    return extractErrorResponse({
      code: "INVALID_REQUEST",
      message: "Body must be valid JSON.",
      details: { error: errorMessage(error) },
    });
  }

  const normalized = normalizeExtractPayload(body);
  if (normalized.error) {
    return extractErrorResponse(normalized.error, 400);
  }
  const { payload } = normalized;

  const tasks = payload!.items.map((item) => async () => {
    const sourceUrl = item.url || "";
    let html = item.html || "";
    let markdown = "";
    let title = "";

    try {
      if (!html) {
        const converted = await convertUrlWithMetrics(
          sourceUrl,
          env,
          host,
          "html",
          item.selector,
          item.forceBrowser,
          item.noCache,
          undefined,
          request.signal,
        );
        html = converted.content;
        title = converted.title;
      }

      const extraction = extractWithStrategy(
        item.strategy,
        html,
        item.schema,
        item.options,
        item.selector,
      );

      if (item.includeMarkdown) {
        const markdownResult = htmlToMarkdown(
          html,
          sourceUrl || "https://example.invalid/",
          item.selector,
        );
        markdown = markdownResult.markdown;
        if (!title) title = markdownResult.title;
      }

      return {
        success: true,
        strategy: item.strategy,
        source: {
          ...(sourceUrl ? { url: sourceUrl } : {}),
          html_bytes: new TextEncoder().encode(html).byteLength,
        },
        data: extraction.data,
        meta: extraction.meta,
        ...(item.includeMarkdown ? { markdown } : {}),
        ...(title ? { title } : {}),
      };
    } catch (error) {
      if (error instanceof ExtractionStrategyError) {
        return {
          success: false,
          strategy: item.strategy,
          source: sourceUrl ? { url: sourceUrl } : undefined,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        };
      }
      if (error instanceof ConvertError) {
        return {
          success: false,
          strategy: item.strategy,
          source: sourceUrl ? { url: sourceUrl } : undefined,
          error: {
            code: "UPSTREAM_FETCH_FAILED",
            message: error.message,
          },
        };
      }
      return {
        success: false,
        strategy: item.strategy,
        source: sourceUrl ? { url: sourceUrl } : undefined,
        error: {
          code: "EXTRACTION_FAILED",
          message: "Failed to extract content from input.",
          details: {
            error: errorMessage(error),
          },
        },
      };
    }
  });

  const settled = await pLimit(tasks, BROWSER_CONCURRENCY);
  const results = settled.map((entry) =>
    entry.status === "fulfilled"
      ? entry.value
      : {
          success: false,
          error: {
            code: "EXTRACTION_FAILED",
            message: "Extraction task execution failed.",
          },
        });

  logMetric("extract.completed", {
    items: payload!.items.length,
    failures: results.filter((item: any) => !item.success).length,
  });

  if (payload!.isBatch) {
    return Response.json({ results }, { headers: CORS_HEADERS });
  }
  return Response.json(results[0], { headers: CORS_HEADERS });
}
