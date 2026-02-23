import { describe, expect, it } from "vitest";
import {
  buildJobRecord,
  isValidStatusTransition,
  jobIdempotencyKey,
  jobStorageKey,
  validateJobCreatePayload,
} from "../dispatcher/model";

describe("dispatcher model", () => {
  it("validates crawl payload", () => {
    const parsed = validateJobCreatePayload({
      type: "crawl",
      tasks: [
        "https://example.com/a",
        { url: "https://example.com/b", format: "markdown" },
      ],
      priority: 7,
      maxRetries: 3,
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.payload?.type).toBe("crawl");
    expect(parsed.payload?.tasks.length).toBe(2);
  });

  it("returns validation error for invalid extract payload", () => {
    const parsed = validateJobCreatePayload({
      type: "extract",
      tasks: [{ html: "<h1>x</h1>" }],
    });

    expect(parsed.payload).toBeUndefined();
    expect(parsed.error?.code).toBe("INVALID_REQUEST");
  });

  it("rejects string tasks for extract jobs", () => {
    const parsed = validateJobCreatePayload({
      type: "extract",
      tasks: ["https://example.com/article"],
    });

    expect(parsed.payload).toBeUndefined();
    expect(parsed.error?.code).toBe("INVALID_REQUEST");
    expect(parsed.error?.message).toContain("must be an object");
  });

  it("returns validation error for invalid crawl task options", () => {
    const badFormat = validateJobCreatePayload({
      type: "crawl",
      tasks: [{ url: "https://example.com/a", format: "xml" }],
    });
    expect(badFormat.error?.code).toBe("INVALID_REQUEST");
    expect(badFormat.error?.message).toContain("format");

    const badSelector = validateJobCreatePayload({
      type: "crawl",
      tasks: [{ url: "https://example.com/a", selector: 123 }],
    });
    expect(badSelector.error?.code).toBe("INVALID_REQUEST");
    expect(badSelector.error?.message).toContain("selector");

    const badForceBrowser = validateJobCreatePayload({
      type: "crawl",
      tasks: [{ url: "https://example.com/a", force_browser: "yes" }],
    });
    expect(badForceBrowser.error?.code).toBe("INVALID_REQUEST");
    expect(badForceBrowser.error?.message).toContain("force_browser");
  });

  it("builds a queued job record", () => {
    const parsed = validateJobCreatePayload({
      type: "crawl",
      tasks: ["https://example.com"],
    });
    const job = buildJobRecord(parsed.payload!);

    expect(job.status).toBe("queued");
    expect(job.totalTasks).toBe(1);
    expect(job.tasks[0].status).toBe("queued");
    expect(job.tasks[0].url).toBe("https://example.com");
  });

  it("builds stable key formats", () => {
    expect(jobStorageKey("abc")).toBe("jobs:v1:abc");
    expect(jobIdempotencyKey("idem")).toBe("jobs:idempotency:v1:idem");
  });

  it("validates status transitions", () => {
    expect(isValidStatusTransition("queued", "running")).toBe(true);
    expect(isValidStatusTransition("running", "succeeded")).toBe(true);
    expect(isValidStatusTransition("succeeded", "running")).toBe(false);
  });
});
