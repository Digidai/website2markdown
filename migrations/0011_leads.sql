-- Pricing-page contact requests. Each one is also emailed to ADMIN_EMAIL
-- (src/handlers/leads.ts); this table keeps them if the email fails.
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  volume TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT '',
  client_ip TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  emailed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
