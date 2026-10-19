CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'contact' CHECK(status IN ('contact','pending','subscribed','unsubscribed')),
  locale TEXT NOT NULL DEFAULT 'zh',
  platform TEXT NOT NULL DEFAULT '',
  consent_version TEXT NOT NULL DEFAULT '',
  consent_at TEXT,
  confirmed_at TEXT,
  confirmation_token TEXT NOT NULL UNIQUE,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_download_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status, created_at);
CREATE TABLE IF NOT EXISTS subscriber_downloads (
  download_id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriber_mail_log (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS admin_login_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_login_codes_created ON admin_login_codes(created_at);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  test_status TEXT NOT NULL DEFAULT '',
  tested_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaign_recipients (
  campaign_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT NOT NULL DEFAULT '',
  sent_at TEXT,
  PRIMARY KEY(campaign_id, subscriber_id)
);
