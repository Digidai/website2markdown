// 任务调度处理

import type {
  Env,
} from "../types";
import {
  CORS_HEADERS,
  VALID_FORMATS,
  BROWSER_CONCURRENCY,
} from "../config";
import { isSafeUrl, isValidUrl } from "../security";
import {
  extractWithStrategy,
  ExtractionStrategyError,
} from "../extraction/strategies";
import {
  buildJobRecord,
  jobStorageKey,
  validateJobCreatePayload,
} from "../dispatcher/model";
import { runTasksWithControls } from "../dispatcher/runner";
import type {
  CrawlTaskInput,
  CrawlTaskInputObject,
  JobCreatePayload,
  JobRecord,
  JobTaskRecord,
} from "../dispatcher/model";
import { incrementCounter, logMetric } from "../runtime-state";
import { recordJobCreated, recordJobRun } from "../observability/metrics";
import { ConvertError } from "../helpers/response";
import { sha256Hex, stableStringify } from "../helpers/crypto";
import { timingSafeEqual } from "../middleware/auth";
import { errorMessage } from "../utils";
import {
  convertUrlWithMetrics,
  RequestAbortedError,
  readBodyWithLimit,
  BodyTooLargeError,
} from "./convert";
import { normalizeExtractItem } from "./extract";
import { sseResponse } from "./stream";

// ─── 常量 ────────────────────────────────────────────────────

const JOBS_BODY_MAX_BYTES = 200_000;
const IDEMPOTENCY_TTL_SECONDS = 86_400;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_JOB_ID_LENGTH = 128;
const JOB_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const JOB_COORDINATOR_ENTRY_KEY = "entry";
const JOB_COORDINATOR_RUN_LOCK_KEY = "run-lock";
const JOB_RUN_LOCK_TTL_MS = 120_000;
const JOB_RUN_LOCK_RENEW_MS = 30_000;
const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "canceled"]);

// ─── 类型定义 ────────────────────────────────────────────────

type StoredJobRecord = JobRecord;
type JobPathAction = "status" | "stream" | "run";

interface JobCreateCoordinatorInput {
  payload: JobCreatePayload;
  idempotencyKey?: string;
}

interface JobRunCoordinatorInput {
  jobId: string;
  host: string;
}

interface JobIdempotencyCoordinatorRecord {
  version: 1;
  payloadHash: string;
  job: JobRecord;
  createdAt: string;
}

interface JobRunLockRecord {
  token: string;
  expiresAt: number;
}

// ─── 辅助函数 ────────────────────────────────────────────────

export async function authorizeApiTokenRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (!env.API_TOKEN) {
    return Response.json(
      { error: "Service misconfigured", message: "API_TOKEN not set" },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || !(await timingSafeEqual(auth.slice(7), env.API_TOKEN))) {
    return Response.json(
      { error: "Unauthorized", message: "Valid Bearer token required" },
      { status: 401, headers: CORS_HEADERS },
    );
  }
  return null;
}

export async function loadStoredJobRecord(env: Env, jobId: string): Promise<StoredJobRecord | null> {
  const raw = await env.CACHE_KV.get(jobStorageKey(jobId), "text");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredJobRecord;
  } catch {
    return null;
  }
}

export function summarizeJob(job: StoredJobRecord): Record<string, unknown> {
  return {
    jobId: job.id,
    type: job.type,
    status: job.status,
    totalTasks: job.totalTasks,
    succeededTasks: job.succeededTasks ?? 0,
    failedTasks: job.failedTasks ?? 0,
    queuedTasks: job.queuedTasks ?? 0,
    runningTasks: job.runningTasks ?? 0,
    canceledTasks: job.canceledTasks ?? 0,
    priority: job.priority ?? 10,
    maxRetries: job.maxRetries ?? 2,
    retryCount: job.retryCount ?? 0,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function parseJobPath(path: string): { id: string; action: JobPathAction } | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  if (parts[0] !== "api" || parts[1] !== "jobs") return null;
  const id = parts[2];
  if (!id) return null;
  if (id.length > MAX_JOB_ID_LENGTH || !JOB_ID_PATTERN.test(id)) return null;
  if (parts.length === 3) return { id, action: "status" };
  if (parts[3] === "stream") return { id, action: "stream" };
  if (parts[3] === "run") return { id, action: "run" };
  return null;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
      reject(new RequestAbortedError());
      return;
    }
    onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new RequestAbortedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function handleGetJob(
  request: Request,
  env: Env,
  jobId: string,
): Promise<Response> {
  const authError = await authorizeApiTokenRequest(request, env);
  if (authError) return authError;

  const job = await loadStoredJobRecord(env, jobId);
  if (!job) {
    return Response.json(
      { error: "Not Found", message: "Job not found." },
      { status: 404, headers: CORS_HEADERS },
    );
  }
  return Response.json(summarizeJob(job), { headers: CORS_HEADERS });
}

export async function handleGetJobStream(
  request: Request,
  env: Env,
  jobId: string,
): Promise<Response> {
  const authError = await authorizeApiTokenRequest(request, env);
  if (authError) return authError;

  return sseResponse(async (send, signal) => {
    const startedAt = Date.now();
    let lastSent = "";

    while (!signal.aborted) {
      const job = await loadStoredJobRecord(env, jobId);
      if (!job) {
        await send("fail", { title: "Not Found", message: "Job not found.", status: 404 });
        return;
      }
      const summary = summarizeJob(job);
      const serialized = JSON.stringify(summary);
      if (serialized !== lastSent) {
        await send("status", summary);
        lastSent = serialized;
      }

      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        await send("done", summary);
        return;
      }

      if (Date.now() - startedAt > 60_000) {
        await send("timeout", {
          message: "Stream timeout reached. Reconnect to continue monitoring.",
        });
        return;
      }

      await sleep(1000, signal);
    }
  }, request.signal);
}

export function recalculateJobCounters(job: JobRecord): void {
  let succeeded = 0;
  let failed = 0;
  let queued = 0;
  let running = 0;
  let canceled = 0;
  let retryCount = 0;

  for (const task of job.tasks) {
    if (task.status === "succeeded") succeeded += 1;
    else if (task.status === "failed") failed += 1;
    else if (task.status === "queued") queued += 1;
    else if (task.status === "running") running += 1;
    else if (task.status === "canceled") canceled += 1;
    retryCount += Math.max(0, task.retryCount || 0);
  }

  job.succeededTasks = succeeded;
  job.failedTasks = failed;
  job.queuedTasks = queued;
  job.runningTasks = running;
  job.canceledTasks = canceled;
  job.retryCount = retryCount;

  if (running > 0) {
    job.status = "running";
  } else if (succeeded === job.totalTasks) {
    job.status = "succeeded";
  } else if (failed > 0 && queued === 0) {
    job.status = "failed";
  } else if (canceled === job.totalTasks) {
    job.status = "canceled";
  } else {
    job.status = "queued";
  }
}

export function normalizeTaskResultForStorage(result: unknown): unknown {
  const raw = JSON.stringify(result ?? null);
  const bytes = new TextEncoder().encode(raw).byteLength;
  if (bytes <= 16_000) return result;
  return { truncated: true, bytes };
}

export function buildJobCreateResponse(
  job: JobRecord,
  idempotent: boolean,
): Record<string, unknown> {
  return {
    jobId: job.id,
    type: job.type,
    status: job.status,
    totalTasks: job.totalTasks,
    priority: job.priority,
    maxRetries: job.maxRetries,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    idempotent,
  };
}

export async function persistStoredJobRecord(env: Env, job: JobRecord): Promise<void> {
  await env.CACHE_KV.put(
    jobStorageKey(job.id),
    JSON.stringify(job),
    { expirationTtl: IDEMPOTENCY_TTL_SECONDS * 30 },
  );
}

export function getJobCoordinatorStub(
  env: Env,
  name: string,
): DurableObjectStub | null {
  if (!env.JOB_COORDINATOR) return null;
  return env.JOB_COORDINATOR.get(env.JOB_COORDINATOR.idFromName(name));
}

export function missingJobCoordinatorResponse(): Response {
  return Response.json(
    { error: "Service misconfigured", message: "JOB_COORDINATOR binding not set" },
    { status: 503, headers: CORS_HEADERS },
  );
}

export async function proxyCoordinatorRequest(
  stub: DurableObjectStub,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return stub.fetch(new Request(`https://job-coordinator${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }));
}

export function buildIdempotencyCoordinatorName(idempotencyKey?: string): string {
  return idempotencyKey
    ? `idempotency:${idempotencyKey}`
    : `create:${crypto.randomUUID()}`;
}

export function buildRunCoordinatorName(jobId: string): string {
  return `run:${jobId}`;
}

export function remainingRetriesForTask(task: JobTaskRecord, maxRetries: number): number {
  return Math.max(0, maxRetries - Math.max(0, task.retryCount || 0));
}

export function isTaskRunnable(task: JobTaskRecord, maxRetries: number): boolean {
  if (task.status === "queued") return true;
  return task.status === "failed" && remainingRetriesForTask(task, maxRetries) > 0;
}

export function recoverInterruptedTasks(job: JobRecord, nowIso: string): boolean {
  let recovered = false;
  for (const task of job.tasks) {
    if (task.status !== "running") continue;
    task.status = "failed";
    task.error = task.error || "Previous run was interrupted.";
    task.result = undefined;
    task.updatedAt = nowIso;
    recovered = true;
  }
  if (recovered) {
    recalculateJobCounters(job);
    job.updatedAt = nowIso;
  }
  return recovered;
}

export async function executeJobRun(
  env: Env,
  host: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<Response> {
  const job = await loadStoredJobRecord(env, jobId);
  if (!job) {
    return Response.json(
      { error: "Not Found", message: "Job not found." },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  const nowIso = new Date().toISOString();
  if (recoverInterruptedTasks(job, nowIso)) {
    await persistStoredJobRecord(env, job);
  }

  const runnableTaskIds = new Set(
    job.tasks
      .filter((task) => isTaskRunnable(task, job.maxRetries))
      .map((task) => task.id),
  );
  if (runnableTaskIds.size === 0) {
    return Response.json(
      {
        ...summarizeJob(job),
        executedTasks: 0,
        failedTasksInRun: 0,
        retriesUsedInRun: 0,
        durationMs: 0,
      },
      { headers: CORS_HEADERS },
    );
  }

  for (const task of job.tasks) {
    if (!runnableTaskIds.has(task.id)) continue;
    task.status = "running";
    task.updatedAt = new Date().toISOString();
  }
  recalculateJobCounters(job);
  job.updatedAt = new Date().toISOString();
  await persistStoredJobRecord(env, job);

  const runnableTasks = job.tasks.filter((task) => runnableTaskIds.has(task.id));
  const runStartedAt = Date.now();
  const results = await runTasksWithControls(
    runnableTasks.map((task) => ({
      id: task.id,
      input: task,
      url: task.url,
      retryCount: task.retryCount,
      maxRetries: remainingRetriesForTask(task, job.maxRetries),
    })),
    async (runnerTask) => {
      const task = runnerTask.input as JobTaskRecord;

      if (job.type === "crawl") {
        const crawlInput = task.input as CrawlTaskInput | CrawlTaskInputObject;
        const targetUrl = typeof crawlInput === "string" ? crawlInput : crawlInput?.url;
        if (typeof targetUrl !== "string" || !isValidUrl(targetUrl) || !isSafeUrl(targetUrl)) {
          return { success: false, statusCode: 400, error: "Invalid or blocked URL" };
        }

        const format = (typeof crawlInput === "object" && crawlInput?.format) || "markdown";
        const selector = typeof crawlInput === "object" ? crawlInput?.selector : undefined;
        const forceBrowser = !!(typeof crawlInput === "object" && crawlInput?.force_browser);
        const noCache = !!(typeof crawlInput === "object" && crawlInput?.no_cache);

        try {
          const converted = await convertUrlWithMetrics(
            targetUrl, env, host,
            VALID_FORMATS.has(format) ? format : "markdown",
            typeof selector === "string" ? selector : undefined,
            forceBrowser, noCache, undefined, signal,
          );
          return {
            success: true,
            result: {
              method: converted.method,
              cached: converted.cached,
              title: converted.title,
              fallbacks: converted.diagnostics.fallbacks,
            },
          };
        } catch (error) {
          if (error instanceof ConvertError) {
            return { success: false, statusCode: error.statusCode, error: error.message };
          }
          return { success: false, error: errorMessage(error) };
        }
      }

      const normalized = normalizeExtractItem(task.input);
      if (normalized.error) {
        return { success: false, statusCode: 400, error: normalized.error.message };
      }
      const item = normalized.item!;
      let html = item.html || "";

      try {
        if (!html) {
          const converted = await convertUrlWithMetrics(
            item.url || "", env, host, "html",
            item.selector, item.forceBrowser, item.noCache,
            undefined, signal,
          );
          html = converted.content;
        }
        const extracted = extractWithStrategy(
          item.strategy, html, item.schema, item.options, item.selector,
        );
        return {
          success: true,
          result: {
            strategy: extracted.strategy,
            meta: extracted.meta,
            data: extracted.data,
          },
        };
      } catch (error) {
        if (error instanceof ExtractionStrategyError) {
          return { success: false, statusCode: 400, error: error.message };
        }
        if (error instanceof ConvertError) {
          return { success: false, statusCode: error.statusCode, error: error.message };
        }
        return { success: false, error: errorMessage(error) };
      }
    },
    {
      concurrency: BROWSER_CONCURRENCY,
      maxRetries: job.maxRetries,
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      rateLimitStatusCodes: [429, 503],
      signal,
    },
  );

  const retriesUsedInRun = results.reduce(
    (sum, item) => sum + Math.max(0, item.attempts - 1), 0,
  );
  const runDurationMs = Math.max(0, Date.now() - runStartedAt);
  incrementCounter("jobRuns");
  incrementCounter("jobRetryAttempts", retriesUsedInRun);
  recordJobRun(runDurationMs, retriesUsedInRun, results.length);

  const resultById = new Map(results.map((item) => [item.id, item]));
  for (const task of job.tasks) {
    const outcome = resultById.get(task.id);
    if (!outcome) continue;
    task.retryCount += Math.max(0, outcome.attempts - 1);
    task.status = outcome.success ? "succeeded" : "failed";
    task.error = outcome.success ? undefined : outcome.error || "Task failed";
    task.result = outcome.success ? normalizeTaskResultForStorage(outcome.result) : undefined;
    task.updatedAt = new Date().toISOString();
  }

  recalculateJobCounters(job);
  job.updatedAt = new Date().toISOString();
  await persistStoredJobRecord(env, job);

  const failedInRun = results.filter((item) => !item.success).length;
  logMetric("jobs.run_completed", {
    jobId: job.id, type: job.type, executedTasks: results.length,
    failedTasksInRun: failedInRun, retriesUsedInRun,
    durationMs: runDurationMs, status: job.status,
  });

  return Response.json(
    {
      ...summarizeJob(job),
      executedTasks: results.length,
      failedTasksInRun: failedInRun,
      retriesUsedInRun,
      durationMs: runDurationMs,
    },
    { headers: CORS_HEADERS },
  );
}

export async function handleRunJob(
  request: Request,
  env: Env,
  host: string,
  jobId: string,
): Promise<Response> {
  const authError = await authorizeApiTokenRequest(request, env);
  if (authError) return authError;

  const stub = getJobCoordinatorStub(env, buildRunCoordinatorName(jobId));
  if (!stub) return missingJobCoordinatorResponse();

  return proxyCoordinatorRequest(
    stub, "/run",
    { jobId, host } satisfies JobRunCoordinatorInput,
    request.signal,
  );
}

export async function handleJobs(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = await authorizeApiTokenRequest(request, env);
  if (authError) return authError;

  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > JOBS_BODY_MAX_BYTES) {
    return Response.json(
      { error: "Request too large", message: `Maximum body size is ${JOBS_BODY_MAX_BYTES} bytes` },
      { status: 413, headers: CORS_HEADERS },
    );
  }

  let body: unknown;
  try {
    const bodyBytes = await readBodyWithLimit(
      request.body, JOBS_BODY_MAX_BYTES,
      `Maximum body size is ${JOBS_BODY_MAX_BYTES} bytes`, request.signal,
    );
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return Response.json(
        { error: "Request too large", message: `Maximum body size is ${JOBS_BODY_MAX_BYTES} bytes` },
        { status: 413, headers: CORS_HEADERS },
      );
    }
    return Response.json(
      { error: "Invalid request body", message: "Body must be valid JSON." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const validated = validateJobCreatePayload(body);
  if (validated.error) {
    return Response.json(
      {
        error: validated.error.code,
        message: validated.error.message,
        ...(validated.error.details ? { details: validated.error.details } : {}),
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const idempotencyHeader = request.headers.get("Idempotency-Key");
  if (idempotencyHeader !== null && !idempotencyHeader.trim()) {
    return Response.json(
      { error: "Invalid request", message: "Idempotency-Key cannot be empty." },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  const idempotencyKey = idempotencyHeader?.trim() || undefined;
  if (idempotencyKey) {
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return Response.json(
        { error: "Invalid request", message: `Idempotency-Key is too long (max ${MAX_IDEMPOTENCY_KEY_LENGTH} characters).` },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return Response.json(
        { error: "Invalid request", message: "Idempotency-Key contains unsupported characters." },
        { status: 400, headers: CORS_HEADERS },
      );
    }
  }

  const stub = getJobCoordinatorStub(env, buildIdempotencyCoordinatorName(idempotencyKey));
  if (!stub) return missingJobCoordinatorResponse();

  return proxyCoordinatorRequest(
    stub, "/create",
    {
      payload: validated.payload!,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    } satisfies JobCreateCoordinatorInput,
    request.signal,
  );
}

export async function createAndPersistJob(
  env: Env,
  payload: JobCreatePayload,
  idempotent: boolean,
): Promise<JobRecord> {
  const job = buildJobRecord(payload);
  await persistStoredJobRecord(env, job);

  incrementCounter("jobsCreated");
  recordJobCreated(job.totalTasks);
  logMetric("jobs.created", {
    jobId: job.id, type: job.type, totalTasks: job.totalTasks,
    priority: job.priority, idempotency: idempotent,
  });

  return job;
}

// ─── JobCoordinator Durable Object ──────────────────────────

export class JobCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === "/create") {
        return await this.handleCreate(request);
      }
      if (url.pathname === "/run") {
        return await this.handleRun(request);
      }
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    } catch (error) {
      console.error("job.coordinator_failed", { path: url.pathname, error: errorMessage(error) });
      return Response.json(
        { error: "Internal Error", message: "Coordinator request failed." },
        { status: 500, headers: CORS_HEADERS },
      );
    }
  }

  private async handleCreate(request: Request): Promise<Response> {
    let body: JobCreateCoordinatorInput;
    try {
      body = await request.json() as JobCreateCoordinatorInput;
    } catch {
      return Response.json(
        { error: "Invalid request", message: "Body must be valid JSON." },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    if (!body || typeof body !== "object" || !body.payload || typeof body.payload !== "object") {
      return Response.json(
        { error: "Invalid request", message: "payload is required." },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    return this.state.blockConcurrencyWhile(async () => {
      if (!body.idempotencyKey) {
        try {
          const job = await createAndPersistJob(this.env, body.payload, false);
          return Response.json(
            buildJobCreateResponse(job, false),
            { status: 202, headers: CORS_HEADERS },
          );
        } catch (error) {
          console.error("Failed to persist job:", errorMessage(error));
          return Response.json(
            { error: "Storage error", message: "Failed to persist job." },
            { status: 500, headers: CORS_HEADERS },
          );
        }
      }

      const payloadHash = await sha256Hex(stableStringify(body.payload));
      const existing = await this.state.storage.get<JobIdempotencyCoordinatorRecord>(
        JOB_COORDINATOR_ENTRY_KEY,
      );

      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          return Response.json(
            { error: "Conflict", message: "Idempotency-Key cannot be reused with a different payload." },
            { status: 409, headers: CORS_HEADERS },
          );
        }

        let job = await loadStoredJobRecord(this.env, existing.job.id);
        if (!job) {
          await persistStoredJobRecord(this.env, existing.job);
          job = existing.job;
        }
        return Response.json(
          buildJobCreateResponse(job, true),
          { status: 200, headers: CORS_HEADERS },
        );
      }

      const job = buildJobRecord(body.payload);
      await this.state.storage.put(JOB_COORDINATOR_ENTRY_KEY, {
        version: 1,
        payloadHash,
        job,
        createdAt: new Date().toISOString(),
      } satisfies JobIdempotencyCoordinatorRecord);

      try {
        await persistStoredJobRecord(this.env, job);
      } catch (error) {
        await this.state.storage.delete(JOB_COORDINATOR_ENTRY_KEY);
        console.error("Failed to persist job:", errorMessage(error));
        return Response.json(
          { error: "Storage error", message: "Failed to persist job." },
          { status: 500, headers: CORS_HEADERS },
        );
      }

      incrementCounter("jobsCreated");
      recordJobCreated(job.totalTasks);
      logMetric("jobs.created", {
        jobId: job.id, type: job.type, totalTasks: job.totalTasks,
        priority: job.priority, idempotency: true,
      });

      return Response.json(
        buildJobCreateResponse(job, false),
        { status: 202, headers: CORS_HEADERS },
      );
    });
  }

  private async handleRun(request: Request): Promise<Response> {
    let body: JobRunCoordinatorInput;
    try {
      body = await request.json() as JobRunCoordinatorInput;
    } catch {
      return Response.json(
        { error: "Invalid request", message: "Body must be valid JSON." },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    if (
      !body || typeof body !== "object" ||
      typeof body.jobId !== "string" || !body.jobId.trim() ||
      typeof body.host !== "string" || !body.host.trim()
    ) {
      return Response.json(
        { error: "Invalid request", message: "jobId and host are required." },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const token = crypto.randomUUID();
    const conflict = await this.acquireRunLock(token);
    if (conflict) return conflict;

    const renewTimer = setInterval(() => {
      void this.renewRunLock(token);
    }, JOB_RUN_LOCK_RENEW_MS);

    try {
      return await executeJobRun(this.env, body.host, body.jobId, request.signal);
    } finally {
      clearInterval(renewTimer);
      await this.releaseRunLock(token);
    }
  }

  private async acquireRunLock(token: string): Promise<Response | null> {
    return this.state.blockConcurrencyWhile(async () => {
      const current = await this.state.storage.get<JobRunLockRecord>(JOB_COORDINATOR_RUN_LOCK_KEY);
      const now = Date.now();
      if (current && current.expiresAt > now) {
        return Response.json(
          { error: "Conflict", message: "Job is already running." },
          { status: 409, headers: CORS_HEADERS },
        );
      }

      await this.state.storage.put(JOB_COORDINATOR_RUN_LOCK_KEY, {
        token,
        expiresAt: now + JOB_RUN_LOCK_TTL_MS,
      } satisfies JobRunLockRecord);
      return null;
    });
  }

  private async renewRunLock(token: string): Promise<void> {
    const current = await this.state.storage.get<JobRunLockRecord>(JOB_COORDINATOR_RUN_LOCK_KEY);
    if (!current || current.token !== token) return;
    await this.state.storage.put(JOB_COORDINATOR_RUN_LOCK_KEY, {
      token,
      expiresAt: Date.now() + JOB_RUN_LOCK_TTL_MS,
    } satisfies JobRunLockRecord);
  }

  private async releaseRunLock(token: string): Promise<void> {
    const current = await this.state.storage.get<JobRunLockRecord>(JOB_COORDINATOR_RUN_LOCK_KEY);
    if (!current || current.token !== token) return;
    await this.state.storage.delete(JOB_COORDINATOR_RUN_LOCK_KEY);
  }
}
