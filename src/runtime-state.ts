// 运行时状态：计数器、限流数据、Paywall 同步状态

export interface RuntimeCounters {
  requestsTotal: number;
  conversionsTotal: number;
  conversionFailures: number;
  streamRequests: number;
  batchRequests: number;
  cacheHits: number;
  browserRenderCalls: number;
  paywallDetections: number;
  paywallFallbacks: number;
  rateLimited: number;
  jobsCreated: number;
  jobRuns: number;
  jobRetryAttempts: number;
  deepCrawlRuns: number;
}

export const runtimeStartedAt = Date.now();

export const runtimeCounters: RuntimeCounters = {
  requestsTotal: 0,
  conversionsTotal: 0,
  conversionFailures: 0,
  streamRequests: 0,
  batchRequests: 0,
  cacheHits: 0,
  browserRenderCalls: 0,
  paywallDetections: 0,
  paywallFallbacks: 0,
  rateLimited: 0,
  jobsCreated: 0,
  jobRuns: 0,
  jobRetryAttempts: 0,
  deepCrawlRuns: 0,
};

export const localRateCounters = new Map<string, { count: number; expiresAt: number }>();
export const degradedRateLimitLogs = new Map<string, number>();

// Paywall 同步状态
export const PAYWALL_RULES_REFRESH_MS = 60_000;
export let lastPaywallRulesSyncAt = 0;
export let lastPaywallRulesSource = "default";
export let lastPaywallRulesRaw = "";

export function setPaywallSyncState(syncAt: number, source: string, raw: string): void {
  lastPaywallRulesSyncAt = syncAt;
  lastPaywallRulesSource = source;
  lastPaywallRulesRaw = raw;
}

export function incrementCounter(name: keyof RuntimeCounters, delta: number = 1): void {
  runtimeCounters[name] += delta;
}

export function logMetric(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({
    event,
    ts: new Date().toISOString(),
    ...data,
  }));
}
