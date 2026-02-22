import { describe, it, expect, vi } from "vitest";
import { BrowserCapacityGate } from "../browser";

describe("BrowserCapacityGate", () => {
  it("validates constructor arguments", () => {
    expect(() => new BrowserCapacityGate(0, 100)).toThrow("maxConcurrent");
    expect(() => new BrowserCapacityGate(1, 0)).toThrow("queueTimeoutMs");
    expect(() => new BrowserCapacityGate(1, 100, -1)).toThrow("maxQueueLength");
  });

  it("limits concurrency and drains queued acquires", async () => {
    const gate = new BrowserCapacityGate(1, 1000);

    const release1 = await gate.acquire("job-1");
    expect(gate.getActiveCount()).toBe(1);

    const queuedAcquire = gate.acquire("job-2");
    expect(gate.getQueueLength()).toBe(1);

    release1();
    const release2 = await queuedAcquire;
    expect(gate.getActiveCount()).toBe(1);
    expect(gate.getQueueLength()).toBe(0);

    release2();
    expect(gate.getActiveCount()).toBe(0);
  });

  it("ignores duplicate release calls", async () => {
    const gate = new BrowserCapacityGate(1, 1000);
    const release = await gate.acquire("dup-release");

    release();
    release();

    expect(gate.getActiveCount()).toBe(0);
  });

  it("throws clear error when queued acquire exceeds timeout", async () => {
    vi.useFakeTimers();
    try {
      const gate = new BrowserCapacityGate(1, 50);
      const release = await gate.acquire("job-1");
      const queuedAcquireError = gate
        .acquire("https://example.com/queued")
        .catch((error: unknown) => error as Error);

      await vi.advanceTimersByTimeAsync(51);

      const errorOrRelease = await queuedAcquireError;
      expect(errorOrRelease).toBeInstanceOf(Error);
      if (!(errorOrRelease instanceof Error)) {
        throw new Error("expected timeout error");
      }
      expect(errorOrRelease.message).toContain("Browser rendering queue timeout");
      expect(errorOrRelease.message).toContain("https://example.com/queued");
      expect(gate.getQueueLength()).toBe(0);

      release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects immediately when browser queue is full", async () => {
    const gate = new BrowserCapacityGate(1, 1000, 1);
    const release = await gate.acquire("job-1");
    const queuedAcquire = gate.acquire("job-2");

    await expect(gate.acquire("job-3")).rejects.toThrow(
      "Browser rendering queue is full",
    );
    expect(gate.getQueueLength()).toBe(1);

    release();
    const release2 = await queuedAcquire;
    release2();
  });

  it("run releases capacity when task fails so queued task can continue", async () => {
    const gate = new BrowserCapacityGate(1, 1000);

    let rejectFirstTask: (reason?: unknown) => void = () => {};
    const firstTask = new Promise<never>((_resolve, reject) => {
      rejectFirstTask = reject;
    });

    const first = gate.run(async () => firstTask, "first");
    const second = gate.run(async () => "ok", "second");

    expect(gate.getQueueLength()).toBe(1);

    rejectFirstTask(new Error("boom"));
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
    expect(gate.getActiveCount()).toBe(0);
  });
});
