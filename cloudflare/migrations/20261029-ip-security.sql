-- Additive, repeatable migration. Existing download history contributes to quotas.
CREATE TABLE IF NOT EXISTS download_security_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  window_minutes INTEGER NOT NULL DEFAULT 30 CHECK(window_minutes BETWEEN 1 AND 1440),
  window_limit INTEGER NOT NULL DEFAULT 3 CHECK(window_limit BETWEEN 1 AND 100),
  daily_limit INTEGER NOT NULL DEFAULT 10 CHECK(daily_limit BETWEEN window_limit AND 1000),
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO download_security_settings(id,updated_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE INDEX IF NOT EXISTS idx_download_events_ip_created ON download_events(ip_address,created_at);
CREATE TABLE IF NOT EXISTS ip_controls (
  ip_address TEXT PRIMARY KEY, blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0,1)),
  message TEXT NOT NULL DEFAULT '', expires_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ip_control_history (
  id TEXT PRIMARY KEY, ip_address TEXT NOT NULL, action TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ip_control_history_created ON ip_control_history(created_at);
