import { describe, expect, it } from "vitest";
import {
  conversionReducer,
  initialConversionState,
  stepDetail,
  stepRows,
  type ConversionEvent,
  type ConversionState,
} from "../../web/conversion-stream";

const run = (events: ConversionEvent[], from: ConversionState = initialConversionState()) =>
  events.reduce(conversionReducer, from);

const statuses = (state: ConversionState) => stepRows(state).map((r) => `${r.id}:${r.status}`);

describe("conversion loading page state machine", () => {
  it("never moves progress backwards when the server reports an earlier step again", () => {
    const state = run([
      { type: "step", data: { id: "analyze", label: "Analyzing content" } },
      { type: "step", data: { id: "browser", label: "Rendering with browser" } },
      { type: "step", data: { id: "fetch", label: "Retrying" } },
    ]);
    expect(statuses(state)).toEqual(["fetch:done", "analyze:done", "browser:active", "convert:pending"]);
    expect(stepDetail(state)).toBe("Retrying");
  });

  it("hides the browser step until it is used and ignores unknown step ids", () => {
    const state = run([
      { type: "step", data: { id: "analyze", label: "Analyzing content" } },
      { type: "step", data: { id: "warp", label: "?" } },
      { type: "step", data: undefined },
    ]);
    expect(statuses(state)).toEqual(["fetch:done", "analyze:active", "convert:pending"]);
    expect(stepDetail(state)).toBe("");
  });

  it("loads the result after done and ignores stream events that arrive late", () => {
    const loading = run([{ type: "done", data: { rawUrl: "/x?raw=true", title: "T", tokenCount: "12" } }]);
    expect(loading.phase).toBe("loadingResult");
    expect(statuses(loading)).toEqual(["fetch:done", "analyze:done", "convert:done"]);
    expect(stepDetail(loading)).toBe("Loading result");

    const late = run([{ type: "fail", data: { title: "X", message: "Y", status: 500 } }, { type: "connectionLost" }, { type: "timeout" }], loading);
    expect(late).toBe(loading);

    const done = run([{ type: "resultLoaded", markdown: "# T" }], loading);
    expect(done).toMatchObject({ phase: "result", markdown: "# T", done: { rawUrl: "/x?raw=true" } });
  });

  it("fails when the result cannot be loaded", () => {
    const state = run([{ type: "done", data: {} }, { type: "resultFailed" }]);
    expect(state).toMatchObject({ phase: "failed", failure: { title: "Could not load the result" } });
  });

  it("keeps the server's failure, including whether a retry can help", () => {
    const state = run([{ type: "fail", data: { title: "Invalid URL", message: "Bad", status: 400, retryable: false, hint: "" } }]);
    expect(state).toEqual({
      phase: "failed",
      attempt: 0,
      failure: { title: "Invalid URL", message: "Bad", status: 400, hint: undefined, retryable: false },
    });
    expect(run([{ type: "fail", data: undefined }])).toMatchObject({ failure: { title: "Error", status: 500 } });
  });

  it("turns a dropped connection into an error instead of a silent restart, and retries from scratch", () => {
    const failed = run([{ type: "step", data: { id: "browser", label: "Rendering with browser" } }, { type: "connectionLost" }]);
    expect(failed).toMatchObject({ phase: "failed", failure: { title: "Connection Lost" } });
    expect(run([{ type: "step", data: { id: "convert", label: "" } }], failed)).toBe(failed);

    const retried = run([{ type: "retry" }], failed);
    expect(retried).toEqual(initialConversionState(1));
    expect(statuses(retried)).toEqual(["fetch:active", "analyze:pending", "convert:pending"]);
  });
});
