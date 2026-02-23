import { describe, expect, it } from "vitest";

import {
  buildOperationalMetricsSnapshot,
  recordConversionLatency,
  recordDeepCrawlRun,
  recordJobCreated,
  recordJobRun,
  resetOperationalMetricsForTests,
} from "../observability/metrics";

describe("observability metrics", () => {
  it("computes throughput/success/retry/backlog/latency snapshots", () => {
    resetOperationalMetricsForTests();

    recordConversionLatency(100);
    recordConversionLatency(200);
    recordConversionLatency(300);
    recordConversionLatency(400);
    recordConversionLatency(500);

    recordJobCreated(10);
    recordJobRun(2000, 2, 4);
    recordJobRun(1000, 1, 2);

    recordDeepCrawlRun(1500);

    const snapshot = buildOperationalMetricsSnapshot(
      Date.now() - 60_000,
      {
        requestsTotal: 120,
        conversionsTotal: 90,
        conversionFailures: 10,
        rateLimited: 5,
      },
      {
        queued: 3,
        maxConcurrent: 2,
      },
    );

    expect(snapshot.throughput.requests_per_min).toBeGreaterThanOrEqual(119);
    expect(snapshot.success_rate.conversions).toBe(0.9);
    expect(snapshot.retry_rate.total_retry_attempts).toBe(3);
    expect(snapshot.retry_rate.executed_tasks).toBe(6);
    expect(snapshot.backlog.estimated_job_tasks).toBe(4);
    expect(snapshot.backlog.total).toBe(7);

    expect(snapshot.latency_ms.convert.count).toBe(5);
    expect(snapshot.latency_ms.convert.p50).toBe(300);
    expect(snapshot.latency_ms.convert.p95).toBe(500);
    expect(snapshot.latency_ms.job_run.count).toBe(2);
    expect(snapshot.latency_ms.deepcrawl.count).toBe(1);
  });
});
