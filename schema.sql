-- md-genedai Auth & Metering schema (D1)
-- Run: wrangler d1 execute AUTH_DB --file=schema.sql

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

-- Magic Link tokens for passwordless email auth
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

-- Global rate limit counters (atomic via D1 upsert, unlike per-colo Cache API).
-- Used for operations where global consistency matters, e.g., magic-link email
-- quota protection against mail bombing.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
