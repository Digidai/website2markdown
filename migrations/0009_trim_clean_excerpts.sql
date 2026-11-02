-- Clean successful conversions now store a 1,000-character preview (see
-- CLEAN_EXCERPT_CHARS in src/admin/analytics.ts). Trim the rows already stored.
-- The WHERE clause is CLEAN_SQL from src/admin/dashboard.ts.
UPDATE conversion_log
SET output_excerpt = substr(output_excerpt, 1, 1000)
WHERE length(output_excerpt) > 1000
  AND outcome = 'success' AND status_code < 400
  AND NOT (COALESCE(output_chars, -1) = 0 OR COALESCE(fallbacks, '') != '' OR duration_ms >= 30000 OR COALESCE(paywall, 0) = 1);
