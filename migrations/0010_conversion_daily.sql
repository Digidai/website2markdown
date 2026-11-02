-- Daily conversion counts for the admin's totals and charts, so loading the
-- page reads a few hundred rows instead of scanning conversion_log.
-- recordConversionLog adds one per conversion. kind and useful use the same
-- rules as CLEAN_SQL / ANOMALY_SQL / FAIL_SQL and the useful-result rule in
-- src/admin/dashboard.ts. Rows are tiny and are not cleaned up.
CREATE TABLE IF NOT EXISTS conversion_daily (
  date TEXT NOT NULL,
  route TEXT NOT NULL,
  platform TEXT NOT NULL,
  outcome TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  error_code TEXT NOT NULL,
  auth_tier TEXT NOT NULL,
  -- 'ok' clean success, 'warn' degraded success, 'bad' failure
  kind TEXT NOT NULL,
  useful INTEGER NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, route, platform, outcome, status_code, error_code, auth_tier, kind, useful)
);

INSERT INTO conversion_daily (date, route, platform, outcome, status_code, error_code, auth_tier, kind, useful, n, credits)
SELECT
  substr(created_at, 1, 10), route, platform, outcome, status_code, error_code, auth_tier,
  CASE
    WHEN outcome != 'success' OR status_code >= 400 THEN 'bad'
    WHEN COALESCE(output_chars, -1) = 0 OR COALESCE(fallbacks, '') != '' OR duration_ms >= 30000 OR COALESCE(paywall, 0) = 1 THEN 'warn'
    ELSE 'ok'
  END,
  CASE WHEN outcome = 'success' AND status_code < 400 AND output_chars >= 800 AND paywall = 0 THEN 1 ELSE 0 END,
  COUNT(*),
  SUM(COALESCE(credit_cost, 0))
FROM conversion_log
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9;
