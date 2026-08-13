import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker, { __test } from "../cloudflare/worker.js";

class FakeD1 {
  calls = [];

  prepare(sql) {
    const database = this;
    return {
      sql,
      values: [],
      bind(...values) { this.values = values; return this; },
      async run() {
        database.calls.push({ method: "run", sql, values: this.values });
        return { meta: { changes: 1 }, results: [] };
      },
      async first() {
        database.calls.push({ method: "first", sql, values: this.values });
        return /COUNT\(\*\)/.test(sql) ? { count: 0 } : { ok: 1 };
      },
      async all() {
        database.calls.push({ method: "all", sql, values: this.values });
        return { results: [] };
      },
    };
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.all()));
  }
}

const origin = "https://musefilm.top";

test("validates and normalizes feedback context without retaining raw addresses", async () => {
  assert.equal(__test.validEmail("film@example.com"), true);
  assert.equal(__test.validEmail("not-an-email"), false);
  assert.equal(__test.normalizePath("gallery#frame"), "/");
  assert.equal(__test.normalizePath("/gallery#frame"), "/gallery#frame");
  assert.equal(__test.normalizePage("https://musefilm.top/?secret=yes#gallery"), "https://musefilm.top/#gallery");
  assert.equal(__test.browserFamily("Mozilla/5.0 Version/18 Safari/605.1"), "Safari");

  const schema = await readFile(new URL("../cloudflare/schema.sql", import.meta.url), "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS visit_events/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS feedback/);
  assert.match(schema, /idx_visit_events_fingerprint_created_at/);
  assert.match(schema, /idx_feedback_fingerprint_created_at/);
  assert.doesNotMatch(schema, /ip_address|raw_ip|user_agent/i);
});

test("serves public configuration only to allowed website origins", async () => {
  const allowed = await worker.fetch(new Request("https://api.musefilm.top/api/config", { headers: { Origin: origin } }), {});
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), origin);
  assert.deepEqual(await allowed.json(), { ok: true, turnstileEnabled: false, turnstileSiteKey: "" });

  const temporaryHttpOrigin = "http://musefilm.top";
  const allowedHttp = await worker.fetch(new Request("https://api.musefilm.top/api/config", { headers: { Origin: temporaryHttpOrigin } }), {});
  assert.equal(allowedHttp.status, 200);
  assert.equal(allowedHttp.headers.get("Access-Control-Allow-Origin"), temporaryHttpOrigin);

  const rejected = await worker.fetch(new Request("https://api.musefilm.top/api/config", { headers: { Origin: "https://example.com" } }), {});
  assert.equal(rejected.status, 403);

  const missingOrigin = await worker.fetch(new Request("https://api.musefilm.top/api/config"), {});
  assert.equal(missingOrigin.status, 403);
});

test("records deduplicated visits and durable feedback through D1", async () => {
  const database = new FakeD1();
  const env = {
    DB: database,
    FINGERPRINT_SALT: "test-only-long-random-salt-over-32-characters",
    ALLOW_UNPROTECTED_FEEDBACK: "true",
  };
  const commonHeaders = {
    Origin: origin,
    "Content-Type": "application/json",
    "CF-Connecting-IP": "203.0.113.9",
    "User-Agent": "Mozilla/5.0 Version/18 Safari/605.1",
  };

  const visit = await worker.fetch(new Request("https://api.musefilm.top/api/visit", {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ path: "/#product", platform: "mac", locale: "zh", referrerHost: "github.com" }),
  }), env);
  assert.equal(visit.status, 202);
  assert.equal((await visit.json()).recorded, true);

  const feedback = await worker.fetch(new Request("https://api.musefilm.top/api/feedback", {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({
      type: "suggestion",
      message: "希望下一版可以继续完善胶卷档案的搜索体验。",
      email: "film@example.com",
      page: "https://musefilm.top/#product",
      locale: "zh",
      platform: "mac",
    }),
  }), env);
  assert.equal(feedback.status, 202);
  assert.deepEqual({ ...(await feedback.json()), id: "ignored" }, { ok: true, id: "ignored", stored: true, emailQueued: false });
  assert.ok(database.calls.some((call) => /INSERT OR IGNORE INTO visit_events/.test(call.sql)));
  assert.ok(database.calls.some((call) => /INSERT INTO feedback/.test(call.sql)));
  assert.ok(database.calls.every((call) => !call.values.includes("203.0.113.9")));
});

test("queues a feedback notification through the restricted email binding", async () => {
  const database = new FakeD1();
  const sent = [];
  const env = {
    DB: database,
    EMAIL: { async send(message) { sent.push(message); return { messageId: "test-message" }; } },
    FEEDBACK_TO_EMAIL: "owner@example.com",
    FEEDBACK_FROM_EMAIL: "feedback@musefilm.top",
    FINGERPRINT_SALT: "test-only-long-random-salt-over-32-characters",
    ALLOW_UNPROTECTED_FEEDBACK: "true",
  };
  const response = await worker.fetch(new Request("https://api.musefilm.top/api/feedback", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.10",
      "User-Agent": "Mozilla/5.0 Version/18 Safari/605.1",
    },
    body: JSON.stringify({
      type: "bug",
      message: "切换胶卷画面后，右下角标签偶尔没有及时更新。",
      email: "visitor@example.com",
      page: "https://musefilm.top/#screens",
      locale: "zh",
      platform: "mac",
    }),
  }), env);

  assert.equal(response.status, 202);
  assert.equal((await response.json()).emailQueued, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "owner@example.com");
  assert.equal(sent[0].from, "feedback@musefilm.top");
  assert.equal(sent[0].replyTo, "visitor@example.com");
  assert.match(sent[0].subject, /MuseFilm.*问题反馈/);
  assert.match(sent[0].text, /右下角标签/);
  assert.ok(database.calls.some((call) => /UPDATE feedback SET email_status/.test(call.sql) && call.values[0] === "sent"));
});
