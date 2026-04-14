/**
 * Browser Use Cloud API client for fetching pages via remote browser.
 * Uses a persistent profile for cookie/session state and a fixed browser.
 *
 * API docs: https://docs.browser-use.com/cloud/api-reference
 */

import { errorMessage } from "./utils";
import { escapeHtml as escapeForHtml } from "./security";

const API_BASE = "https://api.browser-use.com/api/v3";
const PROFILE_ID = "fa51e564-422f-433a-97df-2658ab6cc5aa";
const BROWSER_ID = "34d2c7df-3040-4be7-8502-19a217f9b26b";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 120_000; // 2 minutes max

interface BrowserUseSession {
  id: string;
  status: string;
  output?: string;
  live_url?: string;
}

/**
 * Fetch a URL via Browser Use Cloud agent.
 * Creates an agent session that navigates to the URL, waits for content,
 * and returns the raw HTML via structured output.
 */
export async function fetchViaBrowserUse(
  url: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!apiKey) return null;

  try {
    // 1. Create agent session with task
    const session = await createSession(url, apiKey, signal);
    if (!session?.id) return null;

    // 2. Poll until complete
    const result = await pollSession(session.id, apiKey, signal);
    if (!result?.output) return null;

    // 3. Wrap agent output as HTML for downstream conversion
    const output = result.output.trim();
    if (!output || output.length < 100) return null;

    // If agent returned raw HTML, use as-is
    if (output.includes("<html") || output.includes("<body") || output.includes("<article")) {
      return output;
    }

    // Agent returned text/markdown — wrap in HTML for Readability+Turndown pipeline
    return `<html><head><title></title></head><body><article>${escapeForHtml(output)}</article></body></html>`;
  } catch (e) {
    console.error("Browser Use fetch failed:", errorMessage(e));
    return null;
  }
}

async function createSession(
  url: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<BrowserUseSession | null> {
  const task = [
    `Navigate to ${url}`,
    "Wait for the page to fully load (at least 3 seconds).",
    "Extract the COMPLETE article content including: title, author, publish date, and the full article body text.",
    "Return ALL the content — do not summarize or truncate. Include every paragraph, heading, list, code block, and image URL.",
    "Format the output as the raw article text with headings preserved.",
  ].join("\n");

  const resp = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task,
      model: "claude-sonnet-4.6",
      profile_id: PROFILE_ID,
      proxy_country_code: "us",
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error("Browser Use session create failed:", resp.status, body);
    return null;
  }

  return (await resp.json()) as BrowserUseSession;
}

async function pollSession(
  sessionId: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<BrowserUseSession | null> {
  const deadline = Date.now() + MAX_POLL_MS;

  while (Date.now() < deadline) {
    if (signal?.aborted) return null;

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const resp = await fetch(`${API_BASE}/sessions/${sessionId}`, {
      headers: { "X-Browser-Use-API-Key": apiKey },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) continue;

    const session = (await resp.json()) as BrowserUseSession;

    // "stopped" is the normal terminal state (agent finished and session stopped)
    if (session.status === "completed" || session.status === "finished" || session.status === "stopped") {
      return session;
    }
    if (session.status === "failed" || session.status === "error") {
      console.error("Browser Use session failed:", session.status);
      return null;
    }
    // Still running — continue polling
  }

  // Timed out — try to stop the session
  try {
    await fetch(`${API_BASE}/sessions/${sessionId}/stop`, {
      method: "PUT",
      headers: { "X-Browser-Use-API-Key": apiKey },
      signal: AbortSignal.timeout(5000),
    });
  } catch {}

  console.error("Browser Use session timed out after", MAX_POLL_MS, "ms");
  return null;
}
