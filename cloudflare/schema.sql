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
