import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { jobIdempotencyKey, jobStorageKey } from "../dispatcher/model";
import { createMockEnv } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jobsRequest(
  body: unknown,
  token?: string,
  headers?: Record<string, string>,
): Request {
  return new Request("https://md.example.com/api/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/jobs", () => {
  it("returns 503 when API_TOKEN is missing", async () => {
    const req = jobsRequest({
      type: "crawl",
      tasks: ["https://example.com"],
    }, "token");

    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(503);
    expect(payload.error).toBe("Service misconfigured");
  });

  it("returns 401 for invalid token", async () => {
    const { env } = createMockEnv({ API_TOKEN: "correct" });
    const req = jobsRequest({
      type: "crawl",
      tasks: ["https://example.com"],
    }, "wrong");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(401);
    expect(payload.error).toBe("Unauthorized");
  });

  it("returns 400 for invalid payload", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = jobsRequest({
      type: "extract",
      tasks: [{ html: "<h1>x</h1>" }],
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toBe("INVALID_REQUEST");
  });

  it("creates a queued job and persists it", async () => {
    const { env, mocks } = createMockEnv({ API_TOKEN: "token" });
    const req = jobsRequest({
      type: "crawl",
      tasks: ["https://example.com/a", "https://example.com/b"],
      priority: 5,
      maxRetries: 3,
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      jobId?: string;
      status?: string;
      totalTasks?: number;
      idempotent?: boolean;
    };

    expect(res.status).toBe(202);
    expect(payload.jobId).toBeTruthy();
    expect(payload.status).toBe("queued");
    expect(payload.totalTasks).toBe(2);
    expect(payload.idempotent).toBe(false);
    expect(mocks.kvPut).toHaveBeenCalled();
  });

  it("returns existing job for idempotency key", async () => {
    const { env, mocks } = createMockEnv({ API_TOKEN: "token" });
    const idempotency = "idem-1";
    const existingJobId = "job-existing";
    const existingJob = {
      id: existingJobId,
      type: "crawl",
      status: "queued",
      totalTasks: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    mocks.kvGet.mockImplementation(async (key: string) => {
      if (key === jobIdempotencyKey(idempotency)) return existingJobId;
      if (key === jobStorageKey(existingJobId)) return JSON.stringify(existingJob);
      return null;
    });

    const req = jobsRequest(
      { type: "crawl", tasks: ["https://example.com"] },
      "token",
      { "Idempotency-Key": idempotency },
    );
    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      jobId?: string;
      idempotent?: boolean;
    };

    expect(res.status).toBe(200);
    expect(payload.jobId).toBe(existingJobId);
    expect(payload.idempotent).toBe(true);
  });

  it("runs queued crawl tasks via /api/jobs/:id/run", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("# job run success", {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      }),
    ));

    const { env, mocks } = createMockEnv({ API_TOKEN: "token" });
    const now = "2026-01-01T00:00:00.000Z";
    const queuedJob = {
      id: "job-run-1",
      type: "crawl",
      status: "queued",
      priority: 10,
      maxRetries: 1,
      retryCount: 0,
      totalTasks: 1,
      succeededTasks: 0,
      failedTasks: 0,
      queuedTasks: 1,
      runningTasks: 0,
      canceledTasks: 0,
      tasks: [
        {
          id: "task-1",
          status: "queued",
          retryCount: 0,
          input: "https://example.com/job-a",
          url: "https://example.com/job-a",
          createdAt: now,
          updatedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    mocks.kvGet.mockImplementation(async (key: string) => {
      if (key === jobStorageKey("job-run-1")) return JSON.stringify(queuedJob);
      return null;
    });

    const req = new Request("https://md.example.com/api/jobs/job-run-1/run", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
    });
    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      jobId?: string;
      status?: string;
      executedTasks?: number;
      failedTasksInRun?: number;
    };

    expect(res.status).toBe(200);
    expect(payload.jobId).toBe("job-run-1");
    expect(payload.status).toBe("succeeded");
    expect(payload.executedTasks).toBe(1);
    expect(payload.failedTasksInRun).toBe(0);
    expect(mocks.kvPut).toHaveBeenCalled();
  });
});
