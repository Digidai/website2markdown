-- Store who made each request, for abuse analysis and per-source usage.
-- Rows already expire after 90 days (cleanupAnalytics).
ALTER TABLE access_events ADD COLUMN client_ip TEXT NOT NULL DEFAULT '';
ALTER TABLE access_events ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';
ALTER TABLE access_events ADD COLUMN asn INTEGER;
ALTER TABLE access_events ADD COLUMN as_org TEXT NOT NULL DEFAULT '';
ALTER TABLE access_events ADD COLUMN city TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_access_events_ip ON access_events(client_ip, created_at);

ALTER TABLE conversion_log ADD COLUMN client_ip TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN asn INTEGER;
ALTER TABLE conversion_log ADD COLUMN as_org TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN city TEXT NOT NULL DEFAULT '';
-- Plain IDs so a conversion joins to accounts and api_keys (hashes cannot).
ALTER TABLE conversion_log ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN key_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_conversion_log_account ON conversion_log(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversion_log_ip ON conversion_log(client_ip, created_at);
