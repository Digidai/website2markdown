export interface RunnerTask<TInput = unknown> {
  id: string;
  input: TInput;
  url?: string;
  retryCount?: number;
}

export interface TaskExecutionOutcome {
  success: boolean;
  statusCode?: number;
  error?: string;
  result?: unknown;
}

export interface RunnerTaskResult {
  id: string;
  success: boolean;
  attempts: number;
  statusCode?: number;
  error?: string;
  result?: unknown;
}

export interface RunnerOptions {
  concurrency: number;
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  rateLimitStatusCodes?: number[];
  signal?: AbortSignal;
}

interface DomainState {
  currentDelayMs: number;
  nextAllowedAt: number;
}

function parseDomain(url?: string): string {
  if (!url) return "__default__";
  try {
    return new URL(url).host || "__default__";
  } catch {
    return "__default__";
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let onAbort: (() => void) | undefined;
    const cleanup = () => {
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, ms);
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timer);
      settled = true;
      cleanup();
      reject(new Error("aborted"));
      return;
    }
    onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runTasksWithControls<TInput>(
  tasks: RunnerTask<TInput>[],
  executor: (task: RunnerTask<TInput>) => Promise<TaskExecutionOutcome>,
  options: RunnerOptions,
): Promise<RunnerTaskResult[]> {
  const concurrency = Math.max(1, options.concurrency);
  const maxRetries = Math.max(0, options.maxRetries);
  const baseDelayMs = Math.max(50, options.baseDelayMs ?? 1_000);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 30_000);
  const rateLimitCodes = new Set(options.rateLimitStatusCodes ?? [429, 503]);
  const signal = options.signal;

  const domainState = new Map<string, DomainState>();
  const results: RunnerTaskResult[] = new Array(tasks.length);
  let nextIndex = 0;

  function stateForDomain(domain: string): DomainState {
    const existing = domainState.get(domain);
    if (existing) return existing;
    const created: DomainState = {
      currentDelayMs: baseDelayMs,
      nextAllowedAt: 0,
    };
    domainState.set(domain, created);
    return created;
  }

  async function waitForDomain(domain: string): Promise<void> {
    const state = stateForDomain(domain);
    const now = Date.now();
    const waitMs = Math.max(0, state.nextAllowedAt - now);
    if (waitMs > 0) {
      await sleep(waitMs, signal);
    }
  }

  function markSuccess(domain: string): void {
    const state = stateForDomain(domain);
    state.currentDelayMs = Math.max(baseDelayMs, Math.floor(state.currentDelayMs * 0.75));
    state.nextAllowedAt = Date.now() + Math.min(baseDelayMs, state.currentDelayMs);
  }

  function markFailure(domain: string): void {
    const state = stateForDomain(domain);
    const jitter = 0.75 + Math.random() * 0.5;
    state.currentDelayMs = Math.min(maxDelayMs, Math.floor(state.currentDelayMs * 2 * jitter));
    state.nextAllowedAt = Date.now() + state.currentDelayMs;
  }

  async function processTask(task: RunnerTask<TInput>): Promise<RunnerTaskResult> {
    const domain = parseDomain(task.url);
    let attempts = 0;
    let lastStatusCode: number | undefined;
    let lastError = "";

    while (attempts <= maxRetries) {
      if (signal?.aborted) {
        return {
          id: task.id,
          success: false,
          attempts,
          error: "Task canceled by abort signal.",
        };
      }

      attempts += 1;
      await waitForDomain(domain);

      let outcome: TaskExecutionOutcome;
      try {
        outcome = await executor(task);
      } catch (error) {
        outcome = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      if (outcome.success) {
        markSuccess(domain);
        return {
          id: task.id,
          success: true,
          attempts,
          statusCode: outcome.statusCode,
          result: outcome.result,
        };
      }

      lastStatusCode = outcome.statusCode;
      lastError = outcome.error || "Task failed";
      const shouldRetry =
        attempts <= maxRetries &&
        (!outcome.statusCode || rateLimitCodes.has(outcome.statusCode));

      if (!shouldRetry) {
        markFailure(domain);
        break;
      }

      markFailure(domain);
    }

    return {
      id: task.id,
      success: false,
      attempts,
      statusCode: lastStatusCode,
      error: lastError || "Task failed",
    };
  }

  async function workerLoop(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await processTask(tasks[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => workerLoop());
  await Promise.all(workers);
  return results;
}
