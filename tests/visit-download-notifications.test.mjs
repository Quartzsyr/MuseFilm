import assert from "node:assert/strict";
import test from "node:test";
import worker, { __test } from "../cloudflare/worker.js";

class Database {
  visits = new Set(); downloads = new Map(); statuses = []; count = 0;
  prepare(sql) {
    const db = this;
    return {
      bind(...values) { this.values = values; return this; }, values: [],
      async first() { return /site_counters/.test(sql) ? { visitors: db.count } : { count: 0 }; },
      async run() {
        let changes = 1;
        if (/INSERT OR IGNORE INTO visit_events/.test(sql)) {
          changes = db.visits.has(this.values[0]) ? 0 : 1;
          db.visits.add(this.values[0]); db.count += changes;
        }
        if (/INSERT OR IGNORE INTO download_events/.test(sql)) {
          changes = db.downloads.has(this.values[0]) ? 0 : 1;
          db.downloads.set(this.values[0], this.values);
        }
        if (/UPDATE download_events/.test(sql)) db.statuses.push(this.values[0]);
        return { meta: { changes } };
      },
    };
  }
}
const origin = "https://musefilm.top";
const installerUrl = "https://github.com/Quartzsyr/MuseFilm/releases/download/MAC3.2.2/MuseFilm.dmg";
const headers = { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.20", "User-Agent": "Mozilla/5.0 Macintosh Safari/605.1" };
function env() { return { DB: new Database(), FINGERPRINT_SALT: "test-only-fingerprint-salt-over-thirty-two-characters", FEEDBACK_TO_EMAIL: "owner@example.com", FEEDBACK_FROM_EMAIL: "feedback@musefilm.top" }; }
function request(path, body) { return new Request(`https://api.musefilm.top${path}`, { method: "POST", headers, body: JSON.stringify(body) }); }

test("repeated page loads count while a replayed event is idempotent", async () => {
  const config = env();
  for (const eventId of ["load-1", "load-2", "load-2"]) {
    const response = await worker.fetch(request("/api/visit", { path: "/", eventId }), config);
    assert.equal(response.status, 202);
  }
  const response = await worker.fetch(new Request("https://api.musefilm.top/api/visitors", { headers }), config);
  assert.deepEqual(await response.json(), { ok: true, visitors: 2, metric: "page_views" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("download click emails trusted connection data to the existing owner once", async () => {
  const config = env(); const sent = []; const pending = [];
  config.EMAIL = { async send(message) { sent.push(message); } };
  const body = { eventId: "click-1", downloadUrl: installerUrl, noticeVersion: "2026-10-19", ip: "forged-client-ip", locale: "zh", referrerHost: "example.com" };
  const req = request("/api/download", body);
  Object.defineProperty(req, "cf", { value: { country: "CN", region: "Shanghai", city: "Shanghai", timezone: "Asia/Shanghai", asOrganization: "Test network" } });
  const response = await worker.fetch(req, config, { waitUntil(promise) { pending.push(promise); } });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, recorded: true, emailQueued: true });
  await Promise.all(pending);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "owner@example.com");
  assert.match(sent[0].text, /203\.0\.113\.20/);
  assert.match(sent[0].text, /Shanghai/);
  assert.match(sent[0].text, /不代表 GitHub 已完成下载/);
  assert.doesNotMatch(sent[0].text, /forged-client-ip/);
  assert.equal(config.DB.statuses[0], "sent");
  const repeated = await worker.fetch(request("/api/download", body), config);
  assert.equal((await repeated.json()).recorded, false);
  assert.equal(sent.length, 1);
});

test("notification failures are recorded without failing the download click", async () => {
  const config = env(); config.EMAIL = { async send() { throw new Error("email unavailable"); } };
  const response = await worker.fetch(request("/api/download", { downloadUrl: installerUrl, noticeVersion: "2026-10-19" }), config);
  assert.equal(response.status, 202);
  assert.equal(config.DB.statuses[0], "failed");
});

test("rejects non-installers, external links, undisclosed events and unapproved origins", async () => {
  const config = env();
  assert.equal(__test.installerInfo("https://example.com/file.dmg"), null);
  assert.equal(__test.installerInfo("https://github.com/Quartzsyr/MuseFilm/releases"), null);
  for (const downloadUrl of ["https://example.com/file.dmg", installerUrl + "?secret=value"]) {
    assert.equal((await worker.fetch(request("/api/download", { downloadUrl, noticeVersion: "2026-10-19" }), config)).status, 400);
  }
  assert.equal((await worker.fetch(request("/api/download", { downloadUrl: installerUrl }), config)).status, 400);
  const badOrigin = request("/api/download", { downloadUrl: installerUrl, noticeVersion: "2026-10-19" });
  badOrigin.headers.set("Origin", "https://example.com");
  assert.equal((await worker.fetch(badOrigin, config)).status, 403);
  assert.equal(config.DB.downloads.size, 0);
});

test("email HTML escapes visitor-supplied strings", () => {
  const content = __test.downloadEmailContent({ platform: "mac", asset_name: '<img src=x onerror=alert(1)>', city: '<script>bad()</script>' });
  assert.doesNotMatch(content.html, /<script>|<img/);
  assert.match(content.html, /&lt;img/);
});
