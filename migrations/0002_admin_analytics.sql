-- Operator analytics. Access paths and conversion targets are visible only in /admin.
-- Query strings are not stored. URL userinfo and token-like parameters are stripped.

CREATE TABLE IF NOT EXISTS access_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  colo TEXT NOT NULL DEFAULT '',
  ua_family TEXT NOT NULL DEFAULT '',
  referrer_host TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_access_events_created ON access_events(created_at);
CREATE INDEX IF NOT EXISTS idx_access_events_kind ON access_events(kind, created_at);

CREATE TABLE IF NOT EXISTS conversion_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  route TEXT NOT NULL,
  target_url TEXT NOT NULL,
  target_host TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  method_used TEXT NOT NULL DEFAULT '',
  cache_status TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  auth_tier TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_conversion_log_created ON conversion_log(created_at);
CREATE INDEX IF NOT EXISTS idx_conversion_log_outcome ON conversion_log(outcome, created_at);
