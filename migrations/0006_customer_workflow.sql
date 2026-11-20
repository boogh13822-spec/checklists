-- Additive customer workflow metadata. Existing users, balances and invoices are untouched.
ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT NULL;
ALTER TABLE sms_logs ADD COLUMN fallback_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sms_logs ADD COLUMN delivery_kind TEXT NOT NULL DEFAULT 'legacy';
