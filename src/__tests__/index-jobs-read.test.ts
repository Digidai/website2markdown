import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { jobStorageKey } from "../dispatcher/model";
import { createMockEnv } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/jobs/:id and /api/jobs/:id/stream", () => {
  it("returns 401 without valid bearer token", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = new Request("https://md.example.com/api/jobs/job-1");

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("returns 404 for missing job", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = new Request("https://md.example.com/api/jobs/job-1", {
      headers: { Authorization: "Bearer token" },
    });

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(404);
    expect(payload.error).toBe("Not Found");
  });

  it("returns job summary for existing job", async () => {
    const { env, mocks } = createMockEnv({ API_TOKEN: "token" });
    mocks.kvGet.mockImplementation(async (key: string) => {
      if (key === jobStorageKey("job-1")) {
        return JSON.stringify({
          id: "job-1",
          type: "crawl",
          status: "running",
          totalTasks: 2,
          succeededTasks: 1,
          failedTasks: 0,
          queuedTasks: 0,
          runningTasks: 1,
          canceledTasks: 0,
          priority: 5,
          maxRetries: 2,
          retryCount: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
        });
      }
      return null;
    });

    const req = new Request("https://md.example.com/api/jobs/job-1", {
      headers: { Authorization: "Bearer token" },
    });

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { jobId?: string; status?: string; totalTasks?: number };

    expect(res.status).toBe(200);
    expect(payload.jobId).toBe("job-1");
    expect(payload.status).toBe("running");
    expect(payload.totalTasks).toBe(2);
  });

  it("streams job status and done for terminal job", async () => {
    const { env, mocks } = createMockEnv({ API_TOKEN: "token" });
    mocks.kvGet.mockImplementation(async (key: string) => {
      if (key === jobStorageKey("job-done")) {
        return JSON.stringify({
          id: "job-done",
          type: "crawl",
          status: "succeeded",
          totalTasks: 1,
          succeededTasks: 1,
          failedTasks: 0,
          queuedTasks: 0,
          runningTasks: 0,
          canceledTasks: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:10.000Z",
        });
      }
      return null;
    });

    const req = new Request("https://md.example.com/api/jobs/job-done/stream", {
      headers: { Authorization: "Bearer token" },
    });
    const res = await worker.fetch(req, env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("event: status");
    expect(body).toContain("event: done");
    expect(body).toContain("\"jobId\":\"job-done\"");
  });
});

