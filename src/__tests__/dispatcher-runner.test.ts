import { describe, expect, it, vi } from "vitest";
import { runTasksWithControls } from "../dispatcher/runner";

describe("dispatcher runner", () => {
  it("retries on rate-limit status and succeeds", async () => {
    const callCount = new Map<string, number>();
    const results = await runTasksWithControls(
      [
        { id: "t1", input: { v: 1 }, url: "https://example.com/a" },
        { id: "t2", input: { v: 2 }, url: "https://example.com/b" },
      ],
      async (task) => {
        const c = (callCount.get(task.id) || 0) + 1;
        callCount.set(task.id, c);
        if (c === 1) return { success: false, statusCode: 429, error: "rate limited" };
        return { success: true, result: { ok: true } };
      },
      {
        concurrency: 2,
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 10,
      },
    );

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(results[0].attempts).toBe(2);
    expect(results[1].attempts).toBe(2);
  });

  it("does not retry non-rate-limit errors", async () => {
    const spy = vi.fn(async () => ({ success: false, statusCode: 400, error: "bad request" }));
    const results = await runTasksWithControls(
      [{ id: "t1", input: {}, url: "https://example.com" }],
      spy,
      {
        concurrency: 1,
        maxRetries: 3,
        baseDelayMs: 1,
        maxDelayMs: 10,
      },
    );

    expect(results[0].success).toBe(false);
    expect(results[0].attempts).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

