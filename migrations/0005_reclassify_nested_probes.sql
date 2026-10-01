-- /portal/.env and similar scanner paths were stored as page views because
-- the portal prefix matched before the probe rules. Reclassify every row.
-- Secrets, emails, and raw credentials are still not stored.

UPDATE access_events
SET surface = CASE
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
    OR path LIKE '/api/.env%'
    OR (
      path NOT LIKE '/http%'
      AND instr(substr(path, 2), '/') > 0
      AND instr(substr(path, 2, instr(substr(path, 2), '/') - 1), '.') = 0
      AND (
        path LIKE '%/.env%'
        OR path LIKE '%/.git%'
        OR path LIKE '%/.aws%'
        OR path LIKE '%/.ssh%'
        OR path LIKE '%/wp-admin%'
        OR path LIKE '%/wp-login%'
        OR path LIKE '%/wp-content%'
        OR path LIKE '%/xmlrpc%'
        OR path LIKE '%/cgi-bin%'
        OR path LIKE '%/actuator%'
        OR path LIKE '%/server-status%'
        OR path LIKE '%/@fs%'
        OR path LIKE '%phpunit%'
      )
    ) THEN 'probe'
  WHEN path = '/admin' OR path LIKE '/admin/%' THEN 'admin'
  WHEN path IN ('/', '/examples', '/docs', '/integrations', '/integration', '/portal', '/portal/') OR path LIKE '/portal/%' THEN 'page'
  WHEN path IN ('/favicon.ico', '/robots.txt', '/sitemap.xml', '/llms.txt', '/.well-known/llms.txt')
    OR path LIKE '/.well-known/%'
    OR path LIKE '/img/%'
    OR path LIKE '/r2img/%' THEN 'asset'
  WHEN path = '/api/me' OR path = '/api/keys' OR path LIKE '/api/keys/%' OR path = '/api/auth' OR path LIKE '/api/auth/%' THEN 'account'
  WHEN path IN ('/api/batch', '/api/extract', '/api/deepcrawl', '/api/stream', '/api/jobs', '/api/health', '/api/usage', '/api/og')
    OR path LIKE '/api/jobs/%' THEN 'api'
  WHEN path LIKE '/api/%' THEN 'other'
  WHEN path LIKE '/http%' OR (instr(substr(path, 2), '.') > 0 AND substr(path, 2, 1) != '.') THEN 'api'
  ELSE 'other'
END;
