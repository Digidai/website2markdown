-- Per-day outcome counts for each fallback path (Firecrawl, Jina, proxy pool,
-- browser rendering, archives, ...). One row per (date, path). Stores only the
-- latest sanitized error text, never URLs, keys, or response bodies.
CREATE TABLE IF NOT EXISTS provider_attempts_daily (
  date TEXT NOT NULL,
  path TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  last_failure_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (date, path)
);
