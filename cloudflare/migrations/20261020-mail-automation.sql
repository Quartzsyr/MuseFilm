-- Additive mail automation tables; safe to run again.
CREATE TABLE IF NOT EXISTS subscriber_platforms (
  subscriber_id TEXT NOT NULL, platform TEXT NOT NULL CHECK(platform IN ('windows','mac')),
  created_at TEXT NOT NULL, PRIMARY KEY(subscriber_id,platform)
);
INSERT OR IGNORE INTO subscriber_platforms SELECT id,platform,created_at FROM subscribers WHERE platform IN ('windows','mac');
INSERT OR IGNORE INTO subscriber_platforms SELECT sd.subscriber_id,de.platform,de.created_at FROM subscriber_downloads sd JOIN download_events de ON de.id=sd.download_id WHERE de.platform IN ('windows','mac');
CREATE TABLE IF NOT EXISTS campaign_options (
  campaign_id TEXT PRIMARY KEY, audience TEXT NOT NULL DEFAULT 'all', kind TEXT NOT NULL DEFAULT 'manual',
  scheduled_at TEXT, source_key TEXT UNIQUE, release_url TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS mail_delivery (
  campaign_id TEXT NOT NULL, subscriber_id TEXT NOT NULL, message_id TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL DEFAULT '',
  lease_token TEXT, lease_until TEXT, last_stage TEXT NOT NULL DEFAULT '', retry_safe INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(campaign_id,subscriber_id)
);
CREATE INDEX IF NOT EXISTS idx_mail_delivery_due ON mail_delivery(next_attempt_at);
CREATE TABLE IF NOT EXISTS mail_attempts (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, subscriber_id TEXT NOT NULL,
  attempt INTEGER NOT NULL, status TEXT NOT NULL, error_code TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_attempts_campaign ON mail_attempts(campaign_id,created_at);
CREATE TABLE IF NOT EXISTS mail_suppressions (
  email TEXT PRIMARY KEY, reason TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_bounces (
  id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, campaign_id TEXT NOT NULL, subscriber_id TEXT NOT NULL,
  email TEXT NOT NULL, kind TEXT NOT NULL, diagnostic TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_settings (
  id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 1, include_prerelease INTEGER NOT NULL DEFAULT 0,
  baseline_at TEXT, last_scan_at TEXT, scan_due TEXT NOT NULL DEFAULT '', scan_error TEXT NOT NULL DEFAULT '', etag TEXT NOT NULL DEFAULT '',
  imap_enabled INTEGER NOT NULL DEFAULT 1, imap_last_at TEXT, imap_due TEXT NOT NULL DEFAULT '', imap_error TEXT NOT NULL DEFAULT '',
  imap_uidvalidity TEXT NOT NULL DEFAULT '', imap_cursor INTEGER NOT NULL DEFAULT 0, imap_checked INTEGER NOT NULL DEFAULT 0,
  last_tick_at TEXT
);
INSERT OR IGNORE INTO mail_settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS mail_releases (
  source_key TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, discovered_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_locks (name TEXT PRIMARY KEY, token TEXT NOT NULL, until_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mail_imap_seen (mail_key TEXT PRIMARY KEY, processed_at TEXT NOT NULL, matched INTEGER NOT NULL DEFAULT 0);
