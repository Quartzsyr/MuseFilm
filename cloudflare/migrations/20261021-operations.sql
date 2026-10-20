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
