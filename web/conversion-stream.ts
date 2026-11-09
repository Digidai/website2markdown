/**
 * State machine of the conversion loading page (GET /api/stream).
 *
 *   streaming ──done──▶ loadingResult ──resultLoaded──▶ result
 *       │                     │
 *       └─fail / connectionLost / timeout / resultFailed──▶ failed ──retry──▶ streaming
 *
 * Events that do not apply to the current phase are ignored, so late SSE
 * messages after a terminal event cannot change what the page shows.
 * Plain TypeScript (no DOM) so the Worker tests can import it.
 */
import { STREAM_STEPS, type StreamDoneEvent, type StreamFailEvent, type StreamStepId } from "./contract";

export interface ConversionFailure {
  title: string;
  message: string;
  status?: number;
  hint?: string;
  /** False when trying again cannot help, such as an invalid URL. */
  retryable?: boolean;
}

export type ConversionState =
  | { phase: "streaming"; attempt: number; reached: number; detail: string; usedBrowser: boolean }
  | { phase: "loadingResult"; attempt: number; done: Partial<StreamDoneEvent>; usedBrowser: boolean }
  | { phase: "result"; attempt: number; done: Partial<StreamDoneEvent>; markdown: string }
  | { phase: "failed"; attempt: number; failure: ConversionFailure };

export type ConversionEvent =
  /** SSE payloads arrive as parsed JSON; `undefined` when the data did not parse. */
  | { type: "step"; data: unknown }
  | { type: "done"; data: unknown }
  | { type: "fail"; data: unknown }
  | { type: "connectionLost" }
  | { type: "timeout" }
  | { type: "resultLoaded"; markdown: string }
  | { type: "resultFailed" }
  | { type: "retry" };

/** How long the stream may run before the page gives up. */
export const STREAM_TIMEOUT_MS = 90_000;
/** How long loading the finished Markdown may take. */
export const RESULT_TIMEOUT_MS = 30_000;

export const STEP_LABELS: Record<StreamStepId, string> = {
  fetch: "Fetching page",
  analyze: "Analyzing content",
  browser: "Rendering with browser",
  convert: "Converting to Markdown",
};

const DEFAULT_LABELS = new Set(Object.values(STEP_LABELS));

const FAILURES = {
  timeout: { title: "Timeout", message: "The conversion is taking too long. Please try again.", status: 504 },
  connectionLost: { title: "Connection Lost", message: "Lost connection to the server. Please try again." },
  resultFailed: {
    title: "Could not load the result",
    message: "The conversion finished but the Markdown failed to load. Please try again.",
  },
  unknown: { title: "Error", message: "Failed to process the URL. Please try again later.", status: 500 },
} satisfies Record<string, ConversionFailure>;

export function initialConversionState(attempt = 0): ConversionState {
  return { phase: "streaming", attempt, reached: 0, detail: "", usedBrowser: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stepIndex(id: unknown): number {
  return STREAM_STEPS.indexOf(id as StreamStepId);
}

function toFailure(data: unknown): ConversionFailure {
  const event = data as Partial<StreamFailEvent> | undefined;
  if (!isRecord(event) || typeof event.title !== "string" || typeof event.message !== "string") return FAILURES.unknown;
  return {
    title: event.title,
    message: event.message,
    status: typeof event.status === "number" ? event.status : undefined,
    hint: typeof event.hint === "string" && event.hint ? event.hint : undefined,
    retryable: typeof event.retryable === "boolean" ? event.retryable : undefined,
  };
}

export function conversionReducer(state: ConversionState, event: ConversionEvent): ConversionState {
  switch (state.phase) {
    case "streaming":
      switch (event.type) {
        case "step": {
          const data = isRecord(event.data) ? event.data : {};
          const index = stepIndex(data.id);
          if (index < 0) return state;
          return {
            ...state,
            // A retry reports an earlier step again; progress never moves backwards.
            reached: Math.max(state.reached, index),
            detail: typeof data.label === "string" ? data.label : "",
            usedBrowser: state.usedBrowser || data.id === "browser",
          };
        }
        case "done":
          return {
            phase: "loadingResult",
            attempt: state.attempt,
            done: isRecord(event.data) ? (event.data as Partial<StreamDoneEvent>) : {},
            usedBrowser: state.usedBrowser,
          };
        case "fail":
          return { phase: "failed", attempt: state.attempt, failure: toFailure(event.data) };
        case "connectionLost":
          return { phase: "failed", attempt: state.attempt, failure: FAILURES.connectionLost };
        case "timeout":
          return { phase: "failed", attempt: state.attempt, failure: FAILURES.timeout };
        default:
          return state;
      }
    case "loadingResult":
      if (event.type === "resultLoaded") return { phase: "result", attempt: state.attempt, done: state.done, markdown: event.markdown };
      if (event.type === "resultFailed") return { phase: "failed", attempt: state.attempt, failure: FAILURES.resultFailed };
      return state;
    case "failed":
      return event.type === "retry" ? initialConversionState(state.attempt + 1) : state;
    case "result":
      return state;
  }
}

export type StepStatus = "done" | "active" | "pending";

/** Rows of the progress list. The browser step shows only once it was used. */
export function stepRows(state: ConversionState): { id: StreamStepId; label: string; status: StepStatus }[] {
  if (state.phase === "result" || state.phase === "failed") return [];
  // Once the stream is done, every step is complete.
  const reached = state.phase === "streaming" ? state.reached : STREAM_STEPS.length;
  return STREAM_STEPS
    .map((id, index) => ({ id, index }))
    .filter(({ id }) => id !== "browser" || state.usedBrowser)
    .map(({ id, index }) => ({
      id,
      label: STEP_LABELS[id],
      status: index < reached ? "done" : index === reached ? "active" : "pending",
    }));
}

/** Extra progress text from the server, shown only when it says more than the step name. */
export function stepDetail(state: ConversionState): string {
  if (state.phase === "loadingResult") return "Loading result";
  if (state.phase !== "streaming" || DEFAULT_LABELS.has(state.detail)) return "";
  return state.detail;
}
