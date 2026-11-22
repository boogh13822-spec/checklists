-- Keep customer identity and all financial relations; optional personnel access.
ALTER TABLE users ADD COLUMN staff_role TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN staff_active INTEGER NOT NULL DEFAULT 1;
