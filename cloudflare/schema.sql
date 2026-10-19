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
