const CONTEXT_DEV_SCRAPE_URL = "https://api.context.dev/v1/web/scrape";

interface ScrapeOutput {
  success?: boolean | null;
  data?: string | null;
  error_code?: string;
  message?: string;
}

interface ContextDevScrapeResponse {
  html?: ScrapeOutput;
  metadata?: { finalUrl?: string; title?: string };
  key_metadata?: { credits_remaining?: number };
  message?: string;
  error?: string;
}

/**
 * Fetches a page's rendered HTML through Context.dev, which always renders in a
 * real browser and escalates proxies on its own. HTML (not Markdown) is
 * requested so the site adapters and Readability still run on the result.
 * Failed scrapes, 429s, and auth errors are not charged.
 */
export async function fetchViaContextDev(
  targetUrl: string,
  apiKey: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ html: string; finalUrl: string; creditsRemaining: number | null }> {
  const timeout = AbortSignal.timeout(timeoutMs + 5_000);
  const response = await fetch(CONTEXT_DEV_SCRAPE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url: targetUrl,
      formats: { html: true },
      timeoutOpts: { milliseconds: timeoutMs, behavior: "fail" },
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const text = await response.text();
  let json: ContextDevScrapeResponse = {};
  try {
    json = JSON.parse(text) as ContextDevScrapeResponse;
  } catch {
    // Non-JSON error bodies are reported by status below.
  }
  if (!response.ok) {
    const detail = json.message || json.error || text.replace(/\s+/g, " ").slice(0, 200);
    if (response.status === 402) throw new Error("Context.dev credits exhausted (402)");
    if (response.status === 429) throw new Error("Context.dev rate limited (429)");
    throw new Error(`Context.dev returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const html = json.html?.success ? json.html.data || "" : "";
  if (!html.trim()) {
    throw new Error(`Context.dev returned no HTML${json.html?.error_code ? ` (${json.html.error_code})` : ""}`);
  }
  return {
    html,
    finalUrl: json.metadata?.finalUrl || targetUrl,
    creditsRemaining: json.key_metadata?.credits_remaining ?? null,
  };
}
