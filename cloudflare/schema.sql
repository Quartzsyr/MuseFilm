CREATE TABLE IF NOT EXISTS visit_events (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  path TEXT NOT NULL,
  platform TEXT NOT NULL,
  locale TEXT NOT NULL,
  referrer_host TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'XX',
  browser TEXT NOT NULL DEFAULT 'Other',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visit_events_created_at
ON visit_events(created_at);

CREATE INDEX IF NOT EXISTS idx_visit_events_path_created_at
ON visit_events(path, created_at);

CREATE INDEX IF NOT EXISTS idx_visit_events_fingerprint_created_at
ON visit_events(fingerprint, created_at);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('bug', 'suggestion', 'other')),
  message TEXT NOT NULL,
  contact_email TEXT,
  page_url TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'unknown',
  platform TEXT NOT NULL DEFAULT 'other',
  country TEXT NOT NULL DEFAULT 'XX',
  browser TEXT NOT NULL DEFAULT 'Other',
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewing', 'resolved', 'archived')),
  email_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at
ON feedback(created_at);

CREATE INDEX IF NOT EXISTS idx_feedback_fingerprint_created_at
ON feedback(fingerprint, created_at);

CREATE INDEX IF NOT EXISTS idx_feedback_status_created_at
ON feedback(status, created_at);

PRAGMA optimize;

-- Preserve all recorded historical page views; never invent a starting count.
CREATE TABLE IF NOT EXISTS site_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0 CHECK(value >= 0)
);
INSERT OR IGNORE INTO site_counters(name, value)
SELECT 'page_views', COUNT(*) FROM visit_events;

-- The aggregate survives the scheduled deletion of old event details.
CREATE TRIGGER IF NOT EXISTS increment_total_page_views
AFTER INSERT ON visit_events
BEGIN
  UPDATE site_counters SET value = value + 1 WHERE name = 'page_views';
END;

CREATE TABLE IF NOT EXISTS download_events (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  platform TEXT NOT NULL,
  download_url TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  release_tag TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT '',
  network TEXT NOT NULL DEFAULT '',
  operating_system TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT '',
  referrer_host TEXT NOT NULL DEFAULT '',
  email_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_download_events_created_at ON download_events(created_at);
CREATE INDEX IF NOT EXISTS idx_download_events_fingerprint_created_at ON download_events(fingerprint, created_at);

-- Local afterglow feature, retained independently of the production dashboard.
CREATE TABLE IF NOT EXISTS afterglow_notes (
 id TEXT PRIMARY KEY, message TEXT NOT NULL, mood TEXT NOT NULL DEFAULT 'glow',
 locale TEXT NOT NULL DEFAULT 'zh', country TEXT NOT NULL DEFAULT 'XX', fingerprint TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'reviewing' CHECK(status IN ('reviewing','visible','hidden')),
 reveal_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_afterglow_notes_status_created_at ON afterglow_notes(status,created_at);
CREATE INDEX IF NOT EXISTS idx_afterglow_notes_fingerprint_created_at ON afterglow_notes(fingerprint,created_at);
CREATE TABLE IF NOT EXISTS afterglow_reveals (
 note_id TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(note_id,fingerprint)
);

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

-- Additive and idempotent. Existing campaigns, settings and contacts are preserved.
CREATE TABLE IF NOT EXISTS workflow_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), release_mode TEXT NOT NULL DEFAULT 'draft',
 weekly_enabled INTEGER NOT NULL DEFAULT 1, weekly_day INTEGER NOT NULL DEFAULT 1, weekly_time TEXT NOT NULL DEFAULT '09:00',
 followup_enabled INTEGER NOT NULL DEFAULT 1, followup_days INTEGER NOT NULL DEFAULT 7,
 activated_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_run_at TEXT, last_error TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO workflow_settings(id,activated_at,updated_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE IF NOT EXISTS subscription_events (
 id TEXT PRIMARY KEY, subscriber_id TEXT NOT NULL, event TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_events_created ON subscription_events(created_at);
CREATE TRIGGER IF NOT EXISTS subscription_event_insert AFTER INSERT ON subscribers WHEN NEW.status='subscribed' BEGIN
 INSERT INTO subscription_events VALUES(lower(hex(randomblob(16))),NEW.id,'subscribed',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS subscription_event_update AFTER UPDATE OF status ON subscribers WHEN OLD.status<>NEW.status AND NEW.status IN ('subscribed','unsubscribed') BEGIN
 INSERT INTO subscription_events VALUES(lower(hex(randomblob(16))),NEW.id,NEW.status,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TABLE IF NOT EXISTS weekly_reports (
 id TEXT PRIMARY KEY, period_key TEXT NOT NULL UNIQUE, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
 metrics TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL DEFAULT '', lease_token TEXT, lease_until TEXT,
 retry_safe INTEGER NOT NULL DEFAULT 0, error_code TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, sent_at TEXT
);
