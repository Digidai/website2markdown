import type { ExtractionRequestItem, OutputFormat } from "../types";
import { MAX_SELECTOR_LENGTH, VALID_FORMATS } from "../config";

export type JobType = "crawl" | "extract";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type JobTaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface CrawlTaskInputObject {
  url: string;
  format?: OutputFormat;
  selector?: string;
  force_browser?: boolean;
  no_cache?: boolean;
}

export type CrawlTaskInput = string | CrawlTaskInputObject;
export type ExtractTaskInput = ExtractionRequestItem;

export interface JobTaskRecord {
  id: string;
  status: JobTaskStatus;
  retryCount: number;
  input: CrawlTaskInput | ExtractTaskInput;
  url?: string;
  error?: string;
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: number;
  maxRetries: number;
  retryCount: number;
  totalTasks: number;
  succeededTasks: number;
  failedTasks: number;
  queuedTasks: number;
  runningTasks: number;
  canceledTasks: number;
  tasks: JobTaskRecord[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface JobCreatePayload {
  type: JobType;
  tasks: Array<CrawlTaskInput | ExtractTaskInput>;
  priority?: number;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

export interface JobValidationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export const JOB_KV_PREFIX = "jobs:v1";
export const JOB_IDEMPOTENCY_PREFIX = "jobs:idempotency:v1";
export const MAX_JOB_TASKS = 100;

function nowIso(): string {
  return new Date().toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizePriority(priority: unknown): number {
  if (typeof priority !== "number" || !Number.isFinite(priority)) return 10;
  return Math.min(100, Math.max(1, Math.round(priority)));
}

function normalizeMaxRetries(maxRetries: unknown): number {
  if (typeof maxRetries !== "number" || !Number.isFinite(maxRetries)) return 2;
  return Math.min(10, Math.max(0, Math.round(maxRetries)));
}

function normalizeTaskUrl(task: CrawlTaskInput | ExtractTaskInput): string | undefined {
  if (typeof task === "string") return task;
  if (!isObject(task)) return undefined;
  const maybeUrl = task.url;
  return typeof maybeUrl === "string" ? maybeUrl : undefined;
}

export function jobStorageKey(jobId: string): string {
  return `${JOB_KV_PREFIX}:${jobId}`;
}

export function jobIdempotencyKey(key: string): string {
  return `${JOB_IDEMPOTENCY_PREFIX}:${key}`;
}

export function isValidStatusTransition(
  from: JobStatus,
  to: JobStatus,
): boolean {
  if (from === to) return true;
  if (from === "queued") return to === "running" || to === "canceled" || to === "failed";
  if (from === "running") return to === "succeeded" || to === "failed" || to === "canceled";
  return false;
}

export function validateJobCreatePayload(input: unknown): {
  payload?: JobCreatePayload;
  error?: JobValidationError;
} {
  if (!isObject(input)) {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: "Job payload must be a JSON object.",
      },
    };
  }

  const type = input.type;
  if (type !== "crawl" && type !== "extract") {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: "type must be either crawl or extract.",
      },
    };
  }

  if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: "tasks must be a non-empty array.",
      },
    };
  }
  if (input.tasks.length > MAX_JOB_TASKS) {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: `Maximum ${MAX_JOB_TASKS} tasks allowed per job.`,
      },
    };
  }

  for (let i = 0; i < input.tasks.length; i++) {
    const task = input.tasks[i];
    if (typeof task === "string") {
      if (type === "extract") {
        return {
          error: {
            code: "INVALID_REQUEST",
            message: "extract task must be an object.",
            details: { index: i },
          },
        };
      }
      continue;
    }
    if (!isObject(task)) {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: "Each task must be either a string or an object.",
          details: { index: i },
        },
      };
    }
    if (type === "crawl" && typeof task.url !== "string") {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: "crawl task object must include url.",
          details: { index: i },
        },
      };
    }
    if (type === "crawl") {
      if (task.url.trim().length === 0) {
        return {
          error: {
            code: "INVALID_REQUEST",
            message: "crawl task url must be a non-empty string.",
            details: { index: i },
          },
        };
      }
      if (task.format !== undefined) {
        if (typeof task.format !== "string" || !VALID_FORMATS.has(task.format as OutputFormat)) {
          return {
            error: {
              code: "INVALID_REQUEST",
              message: "crawl task format must be one of: markdown, html, text, json.",
              details: { index: i },
            },
          };
        }
      }
      if (task.selector !== undefined) {
        if (typeof task.selector !== "string") {
          return {
            error: {
              code: "INVALID_REQUEST",
              message: "crawl task selector must be a string.",
              details: { index: i },
            },
          };
        }
        if (task.selector.length > MAX_SELECTOR_LENGTH) {
          return {
            error: {
              code: "INVALID_REQUEST",
              message: `crawl task selector is too long (max ${MAX_SELECTOR_LENGTH} characters).`,
              details: { index: i },
            },
          };
        }
      }
      if (task.force_browser !== undefined && typeof task.force_browser !== "boolean") {
        return {
          error: {
            code: "INVALID_REQUEST",
            message: "crawl task force_browser must be a boolean.",
            details: { index: i },
          },
        };
      }
      if (task.no_cache !== undefined && typeof task.no_cache !== "boolean") {
        return {
          error: {
            code: "INVALID_REQUEST",
            message: "crawl task no_cache must be a boolean.",
            details: { index: i },
          },
        };
      }
    }
    if (type === "extract") {
      if (typeof task.strategy !== "string") {
        return {
          error: {
            code: "INVALID_REQUEST",
            message: "extract task must include strategy.",
            details: { index: i },
          },
        };
      }
      if (typeof task.schema !== "object" || task.schema === null || Array.isArray(task.schema)) {
        return {
          error: {
            code: "INVALID_REQUEST",
            message: "extract task must include schema object.",
            details: { index: i },
          },
        };
      }

      const inputSource = isObject(task.input) ? task.input : {};
      const hasUrl =
        (typeof task.url === "string" && task.url.trim().length > 0) ||
        (typeof inputSource.url === "string" && inputSource.url.trim().length > 0);
      const hasHtml =
        (typeof task.html === "string" && task.html.trim().length > 0) ||
        (typeof inputSource.html === "string" && inputSource.html.trim().length > 0);
      if (!hasUrl && !hasHtml) {
        return {
          error: {
            code: "INVALID_REQUEST",
            message: "extract task must include a non-empty url or html source.",
            details: { index: i },
          },
        };
      }
    }
  }

  const payload: JobCreatePayload = {
    type,
    tasks: input.tasks as Array<CrawlTaskInput | ExtractTaskInput>,
    priority: normalizePriority(input.priority),
    maxRetries: normalizeMaxRetries(input.maxRetries),
    metadata: isObject(input.metadata) ? input.metadata : undefined,
  };

  return { payload };
}

export function buildJobRecord(payload: JobCreatePayload): JobRecord {
  const now = nowIso();
  const tasks: JobTaskRecord[] = payload.tasks.map((task) => ({
    id: crypto.randomUUID(),
    status: "queued",
    retryCount: 0,
    input: task,
    url: normalizeTaskUrl(task),
    createdAt: now,
    updatedAt: now,
  }));

  return {
    id: crypto.randomUUID(),
    type: payload.type,
    status: "queued",
    priority: normalizePriority(payload.priority),
    maxRetries: normalizeMaxRetries(payload.maxRetries),
    retryCount: 0,
    totalTasks: tasks.length,
    succeededTasks: 0,
    failedTasks: 0,
    queuedTasks: tasks.length,
    runningTasks: 0,
    canceledTasks: 0,
    tasks,
    metadata: payload.metadata,
    createdAt: now,
    updatedAt: now,
  };
}
