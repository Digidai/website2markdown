// SSE 流式响应处理

import type { Env } from "../types";
import { CORS_HEADERS, MAX_SELECTOR_LENGTH } from "../config";
import { isSafeUrl, isValidUrl, buildRawRequestPath } from "../security";
import { incrementCounter, logMetric } from "../runtime-state";
import { ConvertError } from "../helpers/response";
import { errorMessage } from "../utils";
import {
  convertUrlWithMetrics,
  RequestAbortedError,
  SseStreamClosedError,
} from "./convert";

export function sseResponse(
  handler: (
    send: (event: string, data: any) => Promise<void>,
    signal: AbortSignal,
  ) => Promise<void>,
  requestSignal?: AbortSignal,
  extraHeaders: Record<string, string> = {},
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const streamAbort = new AbortController();
  let writerOpen = true;

  const abortStream = () => {
    if (!streamAbort.signal.aborted) {
      streamAbort.abort();
    }
  };

  const onRequestAbort = () => abortStream();
  if (requestSignal) {
    if (requestSignal.aborted) {
      abortStream();
    } else {
      requestSignal.addEventListener("abort", onRequestAbort, { once: true });
    }
  }

  writer.closed
    .catch(() => {
      writerOpen = false;
      abortStream();
    })
    .finally(() => {
      writerOpen = false;
    });

  const send = async (event: string, data: any) => {
    if (!writerOpen || streamAbort.signal.aborted) {
      throw new SseStreamClosedError();
    }
    try {
      await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch (error) {
      writerOpen = false;
      abortStream();
      throw new SseStreamClosedError(errorMessage(error));
    }
  };

  handler(send, streamAbort.signal)
    .catch((err) => {
      if (
        err instanceof SseStreamClosedError ||
        err instanceof RequestAbortedError ||
        streamAbort.signal.aborted
      ) {
        return;
      }
      console.error("SSE handler error:", errorMessage(err));
    })
    .finally(() => {
      if (requestSignal) {
        requestSignal.removeEventListener("abort", onRequestAbort);
      }
      abortStream();
      if (writerOpen) {
        writerOpen = false;
        writer.close().catch(() => {});
      }
    });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export function handleStream(
  request: Request,
  env: Env,
  host: string,
  url: URL,
  browserAllowed: boolean = true,
  responseHeaders: Record<string, string> = {},
): Response {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl || !isValidUrl(targetUrl)) {
    return sseResponse(async (send) => {
      await send("fail", { title: "Invalid URL", message: "Please provide a valid HTTP(S) URL.", status: 400 });
    }, request.signal);
  }
  if (!isSafeUrl(targetUrl)) {
    return sseResponse(async (send) => {
      await send("fail", { title: "Blocked", message: "Requests to internal or private addresses are not allowed.", status: 403 });
    }, request.signal);
  }

  const selector = url.searchParams.get("selector") || undefined;
  if (selector && selector.length > MAX_SELECTOR_LENGTH) {
    return sseResponse(async (send) => {
      await send("fail", {
        title: "Invalid Selector",
        message: `selector is too long (max ${MAX_SELECTOR_LENGTH} characters).`,
        status: 400,
      });
    }, request.signal);
  }
  const forceBrowser = url.searchParams.get("force_browser") === "true";
  const noCache = url.searchParams.get("no_cache") === "true";
  const queryToken = url.searchParams.get("token");
  const engine = url.searchParams.get("engine") || undefined;
  const rawRequestPath = buildRawRequestPath(targetUrl, {
    selector,
    forceBrowser,
    noCache,
    engine,
    token: queryToken || undefined,
  });

  return sseResponse(async (send, streamSignal) => {
    try {
      const result = await convertUrlWithMetrics(
        targetUrl, env, host, "markdown", selector, forceBrowser, noCache,
        async (step, label) => { await send("step", { id: step, label }); },
        streamSignal,
        engine,
        browserAllowed,
      );
      await send("done", {
        rawUrl: rawRequestPath,
        title: result.title,
        method: result.method,
        tokenCount: result.tokenCount,
        cached: result.cached,
        fallbacks: result.diagnostics.fallbacks,
      });
      incrementCounter("conversionsTotal");
      if (result.cached || result.diagnostics.cacheHit) incrementCounter("cacheHits");
      if (result.diagnostics.browserRendered || result.method === "browser+readability+turndown") {
        incrementCounter("browserRenderCalls");
      }
      if (result.diagnostics.paywallDetected) incrementCounter("paywallDetections");
      if (result.diagnostics.fallbacks.length > 0) {
        incrementCounter("paywallFallbacks", result.diagnostics.fallbacks.length);
      }
      logMetric("stream.convert_done", {
        method: result.method,
        cached: result.cached,
        fallbacks: result.diagnostics.fallbacks,
      });
    } catch (err) {
      if (
        err instanceof RequestAbortedError ||
        err instanceof SseStreamClosedError ||
        streamSignal.aborted
      ) {
        return;
      }
      if (err instanceof ConvertError) {
        incrementCounter("conversionFailures");
        await send("fail", { title: err.title, message: err.message, status: err.statusCode });
      } else {
        console.error("Stream conversion error:", err);
        incrementCounter("conversionFailures");
        await send("fail", { title: "Error", message: "Failed to process the URL. Please try again later.", status: 500 });
      }
    }
  }, request.signal, responseHeaders);
}
