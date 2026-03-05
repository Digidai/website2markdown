const JINA_DEFAULT_TIMEOUT_MS = 15_000;

interface JinaResponse {
  code: number;
  data: {
    url: string;
    title: string;
    content: string;
  };
}

/**
 * Fetch a URL's content as Markdown via the free r.jina.ai Reader API.
 * No API key — subject to 20 RPM / 2 concurrent / per-IP rate limits.
 */
export async function fetchViaJina(
  targetUrl: string,
  timeoutMs: number = JINA_DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<{ markdown: string; title: string }> {
  const fetchUrl = `https://r.jina.ai/${targetUrl}`;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const response = await fetch(fetchUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: combinedSignal,
    });

    if (response.status === 429) {
      throw new Error("Jina Reader rate limited (429)");
    }
    if (!response.ok) {
      throw new Error(`Jina Reader returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as JinaResponse;

    if (json.code !== undefined && json.code !== 200) {
      throw new Error(`Jina Reader returned error code ${json.code}`);
    }
    if (!json.data?.content) {
      throw new Error("Jina Reader returned empty content");
    }

    return {
      markdown: json.data.content,
      title: json.data.title || "",
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (signal?.aborted) {
        throw new Error("Request aborted");
      }
      throw new Error("Jina Reader timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
