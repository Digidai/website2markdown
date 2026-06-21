import { afterEach, describe, expect, it } from "vitest";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const SCRIPT_PATH = path.join(PROJECT_ROOT, "scripts", "verify-d1-schema.mjs");
const REQUIRED_INDEXES = [
  "idx_api_keys_account",
  "idx_api_keys_hash",
  "idx_conversion_events_daily_date",
  "idx_conversion_events_daily_outcome",
  "idx_conversion_events_daily_platform",
  "idx_conversion_debug_traces_account",
  "idx_conversion_debug_traces_created",
  "idx_conversion_debug_traces_expires",
  "idx_conversion_debug_traces_request",
  "idx_sessions_account",
  "idx_sessions_expires",
  "idx_magic_email",
  "idx_magic_hash",
  "idx_rate_limits_expires",
];
const REQUIRED_COLUMNS = [
  "id",
  "email",
  "github_id",
  "tier",
  "paddle_customer_id",
  "paddle_subscription_id",
  "monthly_credits_used",
  "monthly_credits_reset_at",
  "created_at",
  "updated_at",
  "account_id",
  "prefix",
  "key_hash",
  "name",
  "revoked_at",
  "key_id",
  "date",
  "requests",
  "credits",
  "browser_calls",
  "cache_hits",
  "hour",
  "route",
  "outcome",
  "status_code",
  "error_code",
  "auth_tier",
  "account_hash",
  "target_platform",
  "target_host_hash",
  "country",
  "format",
  "engine_requested",
  "method_used",
  "cache_status",
  "browser_rendered",
  "paywall_detected",
  "duration_bucket",
  "output_size_bucket",
  "selector_present",
  "selector_length_bucket",
  "force_browser",
  "no_cache",
  "request_count",
  "error_count",
  "duration_ms_sum",
  "credit_cost_sum",
  "expires_at",
  "request_id",
  "target_url_hash",
  "target_url_redacted",
  "user_agent_family",
  "fallbacks",
  "source_content_type",
  "output_chars",
  "output_excerpt",
  "error_message_short",
  "duration_ms",
  "trace_source",
  "token_hash",
  "event_id",
  "processed_at",
  "used_at",
  "key",
  "count",
];

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeFakeWrangler(state: {
  table?: boolean;
  indexes?: string[];
  missingColumn?: string;
  failFirstAttempts?: number;
}): { binDir: string; statePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "md-genedai-d1-verify-"));
  tempDirs.push(dir);
  const binDir = path.join(dir, "bin");
  fs.mkdirSync(binDir);
  const statePath = path.join(dir, "state.json");
  fs.writeFileSync(statePath, JSON.stringify({ attempts: 0, ...state }));
  const wranglerPath = path.join(binDir, "wrangler");
  fs.writeFileSync(
    wranglerPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.WRANGLER_FAKE_STATE;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
state.attempts = (state.attempts || 0) + 1;
fs.writeFileSync(statePath, JSON.stringify(state));
if (state.failFirstAttempts && state.attempts <= state.failFirstAttempts) {
  process.exit(42);
}
const commandIndex = process.argv.indexOf("--command");
const command = commandIndex >= 0 ? process.argv[commandIndex + 1] : "";
const requiredColumns = ${JSON.stringify(REQUIRED_COLUMNS)};
let results = [];
if (command.includes("type='table'")) {
  const match = command.match(/name='([^']+)'/);
  const table = match ? match[1] : "conversion_debug_traces";
  results = state.table === false ? [] : [{ name: table }];
} else if (command.startsWith("PRAGMA table_info(")) {
  results = requiredColumns
    .filter((name) => name !== state.missingColumn)
    .map((name, cid) => ({ cid, name }));
} else if (command.startsWith("PRAGMA index_list(")) {
  results = (state.indexes || []).map((name) => ({ name }));
}
process.stdout.write(JSON.stringify([{ success: true, results }]));
`,
  );
  fs.chmodSync(wranglerPath, 0o755);
  return { binDir, statePath };
}

function runVerify(state: Parameters<typeof makeFakeWrangler>[0]): childProcess.SpawnSyncReturns<string> {
  const { binDir, statePath } = makeFakeWrangler(state);
  return childProcess.spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
      WRANGLER_FAKE_STATE: statePath,
    },
    encoding: "utf8",
  });
}

describe("verify-d1-schema script", () => {
  it("passes when conversion debug trace table and required indexes exist", () => {
    const result = runVerify({ indexes: REQUIRED_INDEXES });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "D1 schema verified: required tables, columns, and indexes exist",
    );
  });

  it("fails closed when a required column is missing", () => {
    const result = runVerify({
      indexes: REQUIRED_INDEXES,
      missingColumn: "target_url_redacted",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Missing D1 column: conversion_debug_traces.target_url_redacted");
  });

  it("fails closed when a required debug trace index is missing", () => {
    const result = runVerify({
      indexes: REQUIRED_INDEXES.filter((name) => name !== "idx_conversion_debug_traces_expires"),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Missing D1 index: idx_conversion_debug_traces_expires");
  });

  it("retries transient wrangler failures before failing the deploy gate", () => {
    const result = runVerify({
      indexes: REQUIRED_INDEXES,
      failFirstAttempts: 2,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("D1 verify attempt 1 failed; retrying");
    expect(result.stderr).toContain("D1 verify attempt 2 failed; retrying");
  });
});
