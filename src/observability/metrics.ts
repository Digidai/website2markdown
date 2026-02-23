interface LatencySummary {
  count: number;
  avg: number;
  p50: number;
  p95: number;
}

interface RuntimeCounterSnapshot {
  requestsTotal: number;
  conversionsTotal: number;
  conversionFailures: number;
  rateLimited: number;
  jobRuns?: number;
  jobRetryAttempts?: number;
  jobsCreated?: number;
  deepCrawlRuns?: number;
}

interface BrowserQueueSnapshot {
  queued: number;
  maxConcurrent: number;
}

interface OperationalMetricsSnapshot {
  throughput: {
    requests_per_min: number;
    conversions_per_min: number;
  };
  success_rate: {
    conversions: number;
    conversions_attempts: number;
  };
  retry_rate: {
    jobs: number;
    retries_per_executed_task: number;
    total_retry_attempts: number;
    executed_tasks: number;
  };
  backlog: {
    browser_queue: number;
    estimated_job_tasks: number;
    total: number;
  };
  latency_ms: {
    convert: LatencySummary;
    job_run: LatencySummary;
    deepcrawl: LatencySummary;
  };
  slo_reference: {
    conversion_success_rate_min: number;
    convert_p95_max_ms: number;
    job_retry_rate_max: number;
    browser_queue_max_multiple_of_capacity: number;
  };
}

const LATENCY_WINDOW_LIMIT = 1024;
const convertLatencies: number[] = [];
const jobRunLatencies: number[] = [];
const deepcrawlLatencies: number[] = [];

let totalJobCreatedTasks = 0;
let totalJobExecutedTasks = 0;
let totalJobRetryAttempts = 0;

function clampNumber(value: number, fallback: number = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return value;
}

function round(value: number, digits: number = 3): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function pushLatency(bucket: number[], durationMs: number): void {
  const value = Math.max(0, Math.round(clampNumber(durationMs, 0)));
  bucket.push(value);
  if (bucket.length > LATENCY_WINDOW_LIMIT) {
    bucket.splice(0, bucket.length - LATENCY_WINDOW_LIMIT);
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function summarizeLatencies(values: number[]): LatencySummary {
  if (values.length === 0) {
    return {
      count: 0,
      avg: 0,
      p50: 0,
      p95: 0,
    };
  }
  const total = values.reduce((sum, item) => sum + item, 0);
  return {
    count: values.length,
    avg: round(total / values.length, 2),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
}

export function recordConversionLatency(durationMs: number): void {
  pushLatency(convertLatencies, durationMs);
}

export function recordJobCreated(totalTasks: number): void {
  totalJobCreatedTasks += Math.max(0, Math.floor(clampNumber(totalTasks, 0)));
}

export function recordJobRun(
  durationMs: number,
  retryAttempts: number,
  executedTasks: number,
): void {
  pushLatency(jobRunLatencies, durationMs);
  totalJobRetryAttempts += Math.max(0, Math.floor(clampNumber(retryAttempts, 0)));
  totalJobExecutedTasks += Math.max(0, Math.floor(clampNumber(executedTasks, 0)));
}

export function recordDeepCrawlRun(durationMs: number): void {
  pushLatency(deepcrawlLatencies, durationMs);
}

export function buildOperationalMetricsSnapshot(
  runtimeStartedAt: number,
  counters: RuntimeCounterSnapshot,
  browser: BrowserQueueSnapshot,
): OperationalMetricsSnapshot {
  const nowMs = Date.now();
  const uptimeMinutes = Math.max(1 / 60, (nowMs - runtimeStartedAt) / 60_000);

  const conversionAttempts = Math.max(
    0,
    counters.conversionsTotal + counters.conversionFailures,
  );
  const conversionSuccessRate = conversionAttempts > 0
    ? counters.conversionsTotal / conversionAttempts
    : 1;

  const estimatedJobBacklog = Math.max(0, totalJobCreatedTasks - totalJobExecutedTasks);
  const retryRate = totalJobExecutedTasks > 0
    ? totalJobRetryAttempts / totalJobExecutedTasks
    : 0;

  return {
    throughput: {
      requests_per_min: round(counters.requestsTotal / uptimeMinutes, 3),
      conversions_per_min: round(counters.conversionsTotal / uptimeMinutes, 3),
    },
    success_rate: {
      conversions: round(conversionSuccessRate, 4),
      conversions_attempts: conversionAttempts,
    },
    retry_rate: {
      jobs: round(retryRate, 4),
      retries_per_executed_task: round(retryRate, 4),
      total_retry_attempts: totalJobRetryAttempts,
      executed_tasks: totalJobExecutedTasks,
    },
    backlog: {
      browser_queue: Math.max(0, Math.floor(clampNumber(browser.queued, 0))),
      estimated_job_tasks: estimatedJobBacklog,
      total: Math.max(
        0,
        Math.floor(clampNumber(browser.queued, 0)) + estimatedJobBacklog,
      ),
    },
    latency_ms: {
      convert: summarizeLatencies(convertLatencies),
      job_run: summarizeLatencies(jobRunLatencies),
      deepcrawl: summarizeLatencies(deepcrawlLatencies),
    },
    slo_reference: {
      conversion_success_rate_min: 0.95,
      convert_p95_max_ms: 12_000,
      job_retry_rate_max: 0.15,
      browser_queue_max_multiple_of_capacity: 2,
    },
  };
}

export function resetOperationalMetricsForTests(): void {
  convertLatencies.length = 0;
  jobRunLatencies.length = 0;
  deepcrawlLatencies.length = 0;
  totalJobCreatedTasks = 0;
  totalJobExecutedTasks = 0;
  totalJobRetryAttempts = 0;
}
