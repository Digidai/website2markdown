-- Operator review fields. Excerpts are redacted and capped in the Worker.
-- output_chars stays NULL on rows written before this migration, so an empty
-- body can be told apart from a record that never stored one.

ALTER TABLE conversion_log ADD COLUMN output_excerpt TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN output_chars INTEGER;
ALTER TABLE conversion_log ADD COLUMN error_message TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN fallbacks TEXT NOT NULL DEFAULT '';
ALTER TABLE conversion_log ADD COLUMN paywall INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversion_log ADD COLUMN browser_rendered INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_access_events_status ON access_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_conversion_log_status ON conversion_log(status_code, created_at);
