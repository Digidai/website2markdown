-- Successful conversions now store a 1,000-character preview (see
-- PREVIEW_EXCERPT_CHARS in src/admin/analytics.ts). Trim the rows already
-- stored; failures and paywall detections keep their full excerpt.
UPDATE conversion_log
SET output_excerpt = substr(output_excerpt, 1, 1000)
WHERE length(output_excerpt) > 1000
  AND outcome = 'success' AND status_code < 400 AND COALESCE(paywall, 0) = 0;
