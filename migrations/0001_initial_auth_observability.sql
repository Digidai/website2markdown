-- Initial auth, metering, observability, and cleanup schema.
-- Keep additive and idempotent so existing D1 databases can adopt migration tracking.

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  github_id TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  paddle_customer_id TEXT,
  paddle_subscription_id TEXT,
  monthly_credits_used INTEGER NOT NULL DEFAULT 0,
  monthly_credits_reset_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  name TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id);

CREATE TABLE IF NOT EXISTS usage_daily (
  key_id TEXT NOT NULL REFERENCES api_keys(id),
  date TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  browser_calls INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, date)
);

CREATE TABLE IF NOT EXISTS conversion_events_daily (
  date TEXT NOT NULL,
  hour TEXT NOT NULL,
  route TEXT NOT NULL,
  outcome TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  error_code TEXT NOT NULL DEFAULT '',
  auth_tier TEXT NOT NULL,
  account_hash TEXT NOT NULL DEFAULT '',
  key_hash TEXT NOT NULL DEFAULT '',
  target_platform TEXT NOT NULL,
  target_host_hash TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL,
  engine_requested TEXT NOT NULL DEFAULT '',
  method_used TEXT NOT NULL DEFAULT '',
  cache_status TEXT NOT NULL,
  browser_rendered INTEGER NOT NULL DEFAULT 0,
  paywall_detected INTEGER NOT NULL DEFAULT 0,
  duration_bucket TEXT NOT NULL,
  output_size_bucket TEXT NOT NULL,
  selector_present INTEGER NOT NULL DEFAULT 0,
  selector_length_bucket TEXT NOT NULL DEFAULT 'none',
  force_browser INTEGER NOT NULL DEFAULT 0,
  no_cache INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  duration_ms_sum INTEGER NOT NULL DEFAULT 0,
  credit_cost_sum INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (
    date,
    hour,
    route,
    outcome,
    status_code,
    error_code,
    auth_tier,
    account_hash,
    key_hash,
    target_platform,
    target_host_hash,
    country,
    format,
    engine_requested,
    method_used,
    cache_status,
    browser_rendered,
    paywall_detected,
    duration_bucket,
    output_size_bucket,
    selector_present,
    selector_length_bucket,
    force_browser,
    no_cache
  )
);
CREATE INDEX IF NOT EXISTS idx_conversion_events_daily_date ON conversion_events_daily(date);
CREATE INDEX IF NOT EXISTS idx_conversion_events_daily_platform ON conversion_events_daily(date, target_platform);
CREATE INDEX IF NOT EXISTS idx_conversion_events_daily_outcome ON conversion_events_daily(date, outcome, error_code);

CREATE TABLE IF NOT EXISTS conversion_debug_traces (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  route TEXT NOT NULL,
  outcome TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  error_code TEXT NOT NULL DEFAULT '',
  auth_tier TEXT NOT NULL,
  account_hash TEXT NOT NULL DEFAULT '',
  key_hash TEXT NOT NULL DEFAULT '',
  target_platform TEXT NOT NULL,
  target_url_hash TEXT NOT NULL DEFAULT '',
  target_url_redacted TEXT NOT NULL,
  user_agent_family TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL,
  engine_requested TEXT NOT NULL DEFAULT '',
  method_used TEXT NOT NULL DEFAULT '',
  cache_status TEXT NOT NULL,
  browser_rendered INTEGER NOT NULL DEFAULT 0,
  paywall_detected INTEGER NOT NULL DEFAULT 0,
  fallbacks TEXT NOT NULL DEFAULT '[]',
  source_content_type TEXT,
  selector_present INTEGER NOT NULL DEFAULT 0,
  selector_length_bucket TEXT NOT NULL DEFAULT 'none',
  force_browser INTEGER NOT NULL DEFAULT 0,
  no_cache INTEGER NOT NULL DEFAULT 0,
  output_chars INTEGER,
  output_excerpt TEXT,
  error_message_short TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  trace_source TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_conversion_debug_traces_expires ON conversion_debug_traces(expires_at);
CREATE INDEX IF NOT EXISTS idx_conversion_debug_traces_request ON conversion_debug_traces(request_id);
CREATE INDEX IF NOT EXISTS idx_conversion_debug_traces_created ON conversion_debug_traces(created_at);
CREATE INDEX IF NOT EXISTS idx_conversion_debug_traces_account ON conversion_debug_traces(account_hash, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS paddle_events (
  event_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_magic_hash ON magic_link_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_magic_email ON magic_link_tokens(email);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
