-- Access events moved to the access_events Analytics Engine dataset
-- (see src/admin/access-ae.ts). Dropping the table also drops its indexes.
DROP TABLE IF EXISTS access_events;
