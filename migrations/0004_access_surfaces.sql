-- Split page views, API calls, and usage. Older access rows stored every
-- non-/api/ path as kind='page', including convert URLs and scanner probes.
-- surface is filled for those rows from the path. New columns stay empty or
-- NULL on old rows so "not recorded" stays distinct from a real zero.
-- Secrets, emails, and raw credentials are still not stored.

ALTER TABLE access_events ADD COLUMN surface TEXT NOT NULL DEFAULT '';
ALTER TABLE access_events ADD COLUMN route_name TEXT NOT NULL DEFAULT '';
ALTER TABLE access_events ADD COLUMN auth_present TEXT NOT NULL DEFAULT '';
ALTER TABLE access_events ADD COLUMN duration_ms INTEGER;
ALTER TABLE access_events ADD COLUMN cache_status TEXT NOT NULL DEFAULT '';
ALTER TABLE access_events ADD COLUMN format TEXT NOT NULL DEFAULT '';
ALTER TABLE access_events ADD COLUMN query_redacted TEXT NOT NULL DEFAULT '';
ALTER TABLE access_events ADD COLUMN request_id TEXT NOT NULL DEFAULT '';

ALTER TABLE conversion_log ADD COLUMN request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN engine_requested TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN credit_cost INTEGER;
ALTER TABLE conversion_log ADD COLUMN selector_present INTEGER;
ALTER TABLE conversion_log ADD COLUMN force_browser INTEGER;
ALTER TABLE conversion_log ADD COLUMN no_cache INTEGER;
ALTER TABLE conversion_log ADD COLUMN quota_bucket TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN account_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN key_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN ua_family TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN colo TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN content_type TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN duration_bucket TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN output_size_bucket TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN selector_bucket TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN has_account INTEGER;
ALTER TABLE conversion_log ADD COLUMN has_key INTEGER;

CREATE INDEX IF NOT EXISTS idx_access_events_surface ON access_events(surface, created_at);

UPDATE access_events
SET surface = CASE
  WHEN path = '/admin' OR path LIKE '/admin/%' THEN 'admin'
  WHEN path IN ('/', '/examples', '/docs', '/integrations', '/integration', '/portal', '/portal/') OR path LIKE '/portal/%' THEN 'page'
  WHEN path IN ('/favicon.ico', '/robots.txt', '/sitemap.xml', '/llms.txt', '/.well-known/llms.txt')
    OR path LIKE '/.well-known/%'
    OR path LIKE '/img/%'
    OR path LIKE '/r2img/%' THEN 'asset'
  WHEN path LIKE '/.env%'
    OR path LIKE '/.git%'
    OR path LIKE '/.aws%'
    OR path LIKE '/.ssh%'
    OR path LIKE '/@fs%'
    OR path LIKE '%phpunit%'
    OR path LIKE '/wp-admin%'
    OR path LIKE '/wp-login%'
    OR path LIKE '/wp-content%'
    OR path LIKE '/xmlrpc%'
    OR path LIKE '/cgi-bin%'
    OR path LIKE '/actuator%'
    OR path LIKE '/server-status%'
    OR path LIKE '/api/config%'
    OR path LIKE '/api/proc%'
    OR path LIKE '/api/env%'
    OR path LIKE '/api/.env%' THEN 'probe'
  WHEN path = '/api/me' OR path = '/api/keys' OR path LIKE '/api/keys/%' OR path = '/api/auth' OR path LIKE '/api/auth/%' THEN 'account'
  WHEN path IN ('/api/batch', '/api/extract', '/api/deepcrawl', '/api/stream', '/api/jobs', '/api/health', '/api/usage', '/api/og')
    OR path LIKE '/api/jobs/%' THEN 'api'
  WHEN path LIKE '/api/%' THEN 'other'
  WHEN path LIKE '/http%' OR (instr(substr(path, 2), '.') > 0 AND substr(path, 2, 1) != '.') THEN 'api'
  ELSE 'other'
END
WHERE surface = '';
