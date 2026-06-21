import { execFileSync } from "node:child_process";

const REQUIRED_SCHEMA = {
  accounts: {
    columns: [
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
    ],
    indexes: [],
  },
  api_keys: {
    columns: ["id", "account_id", "prefix", "key_hash", "name", "revoked_at", "created_at"],
    indexes: ["idx_api_keys_account", "idx_api_keys_hash"],
  },
  usage_daily: {
    columns: ["key_id", "date", "requests", "credits", "browser_calls", "cache_hits"],
    indexes: [],
  },
  conversion_events_daily: {
    columns: [
      "date",
      "hour",
      "route",
      "outcome",
      "status_code",
      "error_code",
      "auth_tier",
      "account_hash",
      "key_hash",
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
      "updated_at",
    ],
    indexes: [
      "idx_conversion_events_daily_date",
      "idx_conversion_events_daily_outcome",
      "idx_conversion_events_daily_platform",
    ],
  },
  conversion_debug_traces: {
    columns: [
      "id",
      "created_at",
      "expires_at",
      "request_id",
      "route",
      "outcome",
      "status_code",
      "error_code",
      "auth_tier",
      "account_hash",
      "key_hash",
      "target_platform",
      "target_url_hash",
      "target_url_redacted",
      "user_agent_family",
      "format",
      "engine_requested",
      "method_used",
      "cache_status",
      "browser_rendered",
      "paywall_detected",
      "fallbacks",
      "source_content_type",
      "selector_present",
      "selector_length_bucket",
      "force_browser",
      "no_cache",
      "output_chars",
      "output_excerpt",
      "error_message_short",
      "duration_ms",
      "trace_source",
    ],
    indexes: [
      "idx_conversion_debug_traces_account",
      "idx_conversion_debug_traces_created",
      "idx_conversion_debug_traces_expires",
      "idx_conversion_debug_traces_request",
    ],
  },
  sessions: {
    columns: ["id", "account_id", "token_hash", "expires_at", "created_at"],
    indexes: ["idx_sessions_account", "idx_sessions_expires"],
  },
  paddle_events: {
    columns: ["event_id", "processed_at"],
    indexes: [],
  },
  magic_link_tokens: {
    columns: ["id", "email", "token_hash", "expires_at", "used_at", "created_at"],
    indexes: ["idx_magic_email", "idx_magic_hash"],
  },
  rate_limits: {
    columns: ["key", "count", "expires_at"],
    indexes: ["idx_rate_limits_expires"],
  },
};

function runD1(command) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const output = execFileSync(
        "wrangler",
        ["d1", "execute", "AUTH_DB", "--remote", "--json", "--command", command],
        { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
      );
      const payload = JSON.parse(output);
      if (!Array.isArray(payload) || payload.length === 0 || payload[0]?.success !== true) {
        throw new Error(`D1 command failed: ${command}`);
      }
      return payload[0].results ?? [];
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.warn(`D1 verify attempt ${attempt} failed; retrying...`);
      }
    }
  }
  throw lastError;
}

function hasName(rows, name) {
  return rows.some((row) => row.name === name);
}

for (const [table, contract] of Object.entries(REQUIRED_SCHEMA)) {
  const tables = runD1(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}';`,
  );
  if (!hasName(tables, table)) {
    throw new Error(`Missing D1 table: ${table}`);
  }

  const columns = new Set(runD1(`PRAGMA table_info(${table});`).map((row) => row.name));
  for (const column of contract.columns) {
    if (!columns.has(column)) {
      throw new Error(`Missing D1 column: ${table}.${column}`);
    }
  }

  const indexNames = new Set(runD1(`PRAGMA index_list(${table});`).map((row) => row.name));
  for (const index of contract.indexes) {
    if (!indexNames.has(index)) {
      throw new Error(`Missing D1 index: ${index}`);
    }
  }
}

console.log("D1 schema verified: required tables, columns, and indexes exist");
