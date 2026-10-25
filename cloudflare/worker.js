import {membershipAdmin} from './membership-admin.js';
const DEFAULT_ORIGINS = [
  "https://musefilm.top",
  "https://www.musefilm.top",
  // Temporary compatibility origin. Remove after GitHub Pages can enforce
  // HTTPS for the custom domain.
  "http://musefilm.top",
  "https://quartzsyr.github.io",
  "http://127.0.0.1:5174",
  "http://localhost:5174",
];

const FEEDBACK_TYPES = new Set(["bug", "suggestion", "other"]);
const AFTERGLOW_MOODS = new Set(["glow", "grain", "journey", "reunion"]);
const PUBLIC_API_PATHS = new Set(["/api/config", "/api/visit", "/api/visitors", "/api/feedback", "/api/afterglow", "/api/download"]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function allowedOrigins(env) {
  return new Set([
    ...DEFAULT_ORIGINS,
    ...String(env.ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean),
  ]);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  return Boolean(origin && allowedOrigins(env).has(origin));
}

async function readJson(request, maxBytes = 32_768) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > maxBytes) throw new Error("payload_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("payload_too_large");
  try { return JSON.parse(text); } catch { throw new Error("invalid_json"); }
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function validEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 160;
}

function normalizePath(value) {
  const path = cleanText(value, 300);
  return path.startsWith("/") ? path : "/";
}

function normalizePage(value) {
  const page = cleanText(value, 500);
  try {
    const url = new URL(page);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    return `${url.origin}${url.pathname}${url.hash}`.slice(0, 500);
  } catch { return ""; }
}

function browserFamily(userAgent) {
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/Chrome\//i.test(userAgent)) return "Chrome";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "Other";
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "0.0.0.0";
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fingerprintSalt(env) {
  const salt = String(env.FINGERPRINT_SALT || "");
  if (salt.length < 32) throw new Error("service_not_configured");
  return salt;
}

async function visitorFingerprint(request, env, day) {
  return sha256(`${day}:${clientIp(request)}:${fingerprintSalt(env)}`);
}

async function feedbackFingerprint(request, env) {
  const agent = request.headers.get("User-Agent") || "unknown";
  return sha256(`${clientIp(request)}:${agent}:${fingerprintSalt(env)}`);
}

async function afterglowFingerprint(request, env) {
  return feedbackFingerprint(request, env);
}

async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET_KEY) return env.ALLOW_UNPROTECTED_FEEDBACK === "true";
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  const ip = clientIp(request);
  if (ip !== "0.0.0.0") form.append("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true;
}

async function recordVisit(request, env, headers) {
  const body = await readJson(request, 8192);
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const path = normalizePath(body.path);
  const fingerprint = await visitorFingerprint(request, env, day);
  // A new page load counts again. Replaying the same event does not.
  const eventId = cleanText(body.eventId, 100) || crypto.randomUUID();
  const id = await sha256(`${fingerprint}:${eventId}`);
  const agent = request.headers.get("User-Agent") || "";
  const platform = cleanText(body.platform, 24) || "other";
  const locale = cleanText(body.locale, 12) || "unknown";
  const referrer = cleanText(body.referrerHost, 160);
  const country = cleanText(request.cf?.country, 8) || "XX";

  const recent = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM visit_events
    WHERE fingerprint = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')
  `).bind(fingerprint).first();
  if (Number(recent?.count || 0) >= 120) {
    return json({ ok: false, error: "rate_limited" }, 429, headers);
  }

  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO visit_events
      (id, fingerprint, path, platform, locale, referrer_host, country, browser, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, fingerprint, path, platform, locale, referrer, country, browserFamily(agent), now.toISOString()).run();

  return json({ ok: true, recorded: Number(result.meta?.changes || 0) > 0 }, 202, headers);
}

async function publicVisitorCount(env, headers) {
  const result = await env.DB.prepare("SELECT value AS visitors FROM site_counters WHERE name = 'page_views'").first();
  return json({
    ok: true,
    visitors: Math.max(0, Number(result?.visitors || 0)),
    metric: "page_views",
  }, 200, {
    ...headers,
    "Cache-Control": "no-store",
  });
}

function feedbackSubject(type) {
  if (type === "bug") return "MuseFilm 问题反馈";
  if (type === "suggestion") return "MuseFilm 功能建议";
  return "MuseFilm 用户反馈";
}

const FEEDBACK_EMAIL_THEMES = {
  bug: {
    label: "问题反馈",
    eyebrow: "ISSUE REPORT",
    title: "这里有一处，值得被修好。",
    accent: "#ff665a",
    accentSoft: "#351817",
    mark: "!",
  },
  suggestion: {
    label: "功能建议",
    eyebrow: "FEATURE NOTE",
    title: "下一卷，可以更好。",
    accent: "#67b8ff",
    accentSoft: "#12283a",
    mark: "+",
  },
  other: {
    label: "其他想法",
    eyebrow: "A NEW THOUGHT",
    title: "一束新的想法，抵达 MuseFilm。",
    accent: "#d8a85f",
    accentSoft: "#322619",
    mark: "·",
  },
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character]));
}

function feedbackEmailHtml(feedback) {
  const theme = FEEDBACK_EMAIL_THEMES[feedback.type] || FEEDBACK_EMAIL_THEMES.other;
  const message = escapeHtml(feedback.message).replace(/\r?\n/g, "<br>");
  const contact = feedback.email ? escapeHtml(feedback.email) : "未填写";
  const page = feedback.page ? escapeHtml(feedback.page) : "未知";
  const pageCell = feedback.page
    ? `<a href="${page}" style="color:${theme.accent};text-decoration:none;word-break:break-all;">${page}</a>`
    : page;
  const replyButton = feedback.email
    ? `<a href="mailto:${contact}" style="display:inline-block;background:${theme.accent};color:#080808;text-decoration:none;font-size:13px;font-weight:700;line-height:44px;padding:0 22px;border-radius:999px;">回复反馈者&nbsp;&nbsp;↗</a>`
    : "";
  const detailRows = [
    ["联系邮箱", contact],
    ["页面", pageCell],
    ["平台", escapeHtml(feedback.platform)],
    ["语言", escapeHtml(feedback.locale)],
    ["国家 / 地区", escapeHtml(feedback.country)],
    ["浏览器", escapeHtml(feedback.browser)],
  ].map(([label, value]) => `
    <tr>
      <td class="meta-label" style="padding:11px 0;color:#77756f;font-size:12px;letter-spacing:.08em;border-bottom:1px solid #2b2a27;vertical-align:top;width:112px;">${label}</td>
      <td style="padding:11px 0;color:#d8d6d0;font-size:13px;line-height:1.55;border-bottom:1px solid #2b2a27;vertical-align:top;word-break:break-word;">${value}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    @media only screen and (max-width:620px){
      .shell{width:100%!important}.pad{padding-left:24px!important;padding-right:24px!important}
      .headline{font-size:30px!important}.meta-label{width:88px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#090909;color:#f5f2ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(theme.label)} · ${escapeHtml(feedback.message).slice(0, 80)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#090909;">
    <tr><td align="center" style="padding:30px 14px;">
      <table role="presentation" class="shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#151514;border:1px solid #302f2c;border-radius:24px;overflow:hidden;">
        <tr>
          <td class="pad" style="padding:28px 38px 22px;background:${theme.accentSoft};border-bottom:1px solid #302f2c;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="font-size:18px;font-weight:750;color:#f6f2ea;letter-spacing:-.02em;">MuseFilm</td>
                <td align="right"><span style="display:inline-block;padding:7px 11px;border:1px solid ${theme.accent};border-radius:999px;color:${theme.accent};font-size:10px;font-weight:700;letter-spacing:.12em;">${theme.eyebrow}</span></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="pad" style="padding:42px 38px 18px;">
            <div style="width:44px;height:44px;line-height:42px;text-align:center;border-radius:50%;background:${theme.accent};color:#090909;font-size:24px;font-weight:800;margin-bottom:25px;">${theme.mark}</div>
            <div style="color:${theme.accent};font-size:11px;font-weight:700;letter-spacing:.16em;margin-bottom:12px;">${theme.label}</div>
            <div class="headline" style="font-size:38px;line-height:1.16;font-weight:760;letter-spacing:-.045em;color:#f7f3ec;">${theme.title}</div>
          </td>
        </tr>
        <tr>
          <td class="pad" style="padding:22px 38px 8px;">
            <div style="padding:24px 25px;background:#1d1d1b;border:1px solid #34332f;border-left:3px solid ${theme.accent};border-radius:15px;color:#f0ede7;font-size:16px;line-height:1.85;word-break:break-word;">${message}</div>
          </td>
        </tr>
        <tr>
          <td class="pad" style="padding:25px 38px 8px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${detailRows}</table>
          </td>
        </tr>
        <tr>
          <td class="pad" style="padding:27px 38px 38px;">${replyButton}</td>
        </tr>
        <tr>
          <td class="pad" style="padding:20px 38px;background:#10100f;border-top:1px solid #292825;color:#66645f;font-size:10px;line-height:1.7;letter-spacing:.05em;">
            FEEDBACK&nbsp;&nbsp;${escapeHtml(feedback.id)}<br>
            ${escapeHtml(feedback.createdAt)} · 由 musefilm.top 安全接收
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function deliverFeedbackEmail(env, feedback) {
  let emailStatus = "not_configured";
  if (env.EMAIL && env.FEEDBACK_TO_EMAIL && env.FEEDBACK_FROM_EMAIL) {
    try {
      const lines = [
        feedbackSubject(feedback.type),
        "",
        feedback.message,
        "",
        `联系邮箱: ${feedback.email || "未填写"}`,
        `页面: ${feedback.page || "未知"}`,
        `平台: ${feedback.platform}`,
        `语言: ${feedback.locale}`,
        `国家/地区: ${feedback.country}`,
        `浏览器: ${feedback.browser}`,
        `反馈编号: ${feedback.id}`,
        `时间: ${feedback.createdAt}`,
      ];
      await env.EMAIL.send({
        to: env.FEEDBACK_TO_EMAIL,
        from: env.FEEDBACK_FROM_EMAIL,
        subject: `[MuseFilm] ${feedbackSubject(feedback.type)}`,
        html: feedbackEmailHtml(feedback),
        text: lines.join("\n"),
        ...(feedback.email ? { replyTo: feedback.email } : {}),
      });
      emailStatus = "sent";
    } catch (error) {
      emailStatus = `failed:${cleanText(error?.code || "unknown", 48)}`;
      console.error(JSON.stringify({
        message: "feedback email failed",
        feedbackId: feedback.id,
        error: cleanText(error?.message || error, 200),
      }));
    }
  }
  await env.DB.prepare("UPDATE feedback SET email_status = ? WHERE id = ?").bind(emailStatus, feedback.id).run();
}

async function submitFeedback(request, env, headers, ctx) {
  const body = await readJson(request);
  if (cleanText(body.website, 200)) return json({ ok: true, stored: true, emailed: false }, 202, headers);

  const type = FEEDBACK_TYPES.has(body.type) ? body.type : "other";
  const message = cleanText(body.message, 2000);
  const email = cleanText(body.email, 160).toLowerCase();
  if (message.length < 10) return json({ ok: false, error: "message_too_short" }, 400, headers);
  if (!validEmail(email)) return json({ ok: false, error: "invalid_email" }, 400, headers);
  if (!(await verifyTurnstile(cleanText(body.turnstileToken, 4096), request, env))) {
    return json({ ok: false, error: "verification_required" }, 403, headers);
  }

  const fingerprint = await feedbackFingerprint(request, env);
  const recent = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM feedback
    WHERE fingerprint = ? AND created_at >= datetime('now', '-1 hour')
  `).bind(fingerprint).first();
  if (Number(recent?.count || 0) >= 5) return json({ ok: false, error: "rate_limited" }, 429, headers);

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const agent = request.headers.get("User-Agent") || "";
  const page = normalizePage(body.page);
  const locale = cleanText(body.locale, 12) || "unknown";
  const platform = cleanText(body.platform, 24) || "other";
  const country = cleanText(request.cf?.country, 8) || "XX";

  await env.DB.prepare(`
    INSERT INTO feedback
      (id, type, message, contact_email, page_url, locale, platform, country, browser, fingerprint, status, email_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'pending', ?)
  `).bind(id, type, message, email || null, page, locale, platform, country, browserFamily(agent), fingerprint, createdAt).run();

  const emailConfigured = Boolean(env.EMAIL && env.FEEDBACK_TO_EMAIL && env.FEEDBACK_FROM_EMAIL);
  const emailPromise = deliverFeedbackEmail(env, {
    id,
    type,
    message,
    email,
    page,
    locale,
    platform,
    country,
    browser: browserFamily(agent),
    createdAt,
  });
  if (ctx?.waitUntil) ctx.waitUntil(emailPromise);
  else await emailPromise;

  return json({ ok: true, id, stored: true, emailQueued: emailConfigured }, 202, headers);
}

function publicAfterglowNote(row, fingerprint = "") {
  return {
    id: row.id,
    message: row.message,
    mood: AFTERGLOW_MOODS.has(row.mood) ? row.mood : "glow",
    locale: row.locale === "en" ? "en" : "zh",
    reveals: Math.max(0, Number(row.reveal_count || 0)),
    revealed: Boolean(fingerprint && row.viewer_revealed),
    createdAt: row.created_at,
  };
}

async function listAfterglow(request, env, headers) {
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") === "en" ? "en" : "zh";
  const fingerprint = await afterglowFingerprint(request, env);
  const result = await env.DB.prepare(`
    SELECT n.id, n.message, n.mood, n.locale, n.country, n.reveal_count, n.created_at,
      EXISTS(SELECT 1 FROM afterglow_reveals r WHERE r.note_id = n.id AND r.fingerprint = ?) AS viewer_revealed
    FROM afterglow_notes n
    WHERE n.status = 'visible'
    ORDER BY CASE WHEN n.locale = ? THEN 0 ELSE 1 END, RANDOM()
    LIMIT 9
  `).bind(fingerprint, locale).all();
  return json({ ok: true, notes: (result.results || []).map((row) => publicAfterglowNote(row, fingerprint)) }, 200, {
    ...headers,
    "Cache-Control": "private, no-store",
  });
}

async function submitAfterglow(request, env, headers) {
  const body = await readJson(request, 8192);
  if (cleanText(body.website, 200)) return json({ ok: true, stored: true }, 202, headers);
  const message = cleanText(body.message, 120);
  const mood = AFTERGLOW_MOODS.has(body.mood) ? body.mood : "glow";
  const locale = body.locale === "en" ? "en" : "zh";
  if (message.length < 4) return json({ ok: false, error: "message_too_short" }, 400, headers);
  if (!(await verifyTurnstile(cleanText(body.turnstileToken, 4096), request, env))) {
    return json({ ok: false, error: "verification_required" }, 403, headers);
  }
  const fingerprint = await afterglowFingerprint(request, env);
  const recent = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM afterglow_notes
    WHERE fingerprint = ? AND created_at >= datetime('now', '-24 hours')
  `).bind(fingerprint).first();
  if (Number(recent?.count || 0) >= 3) return json({ ok: false, error: "rate_limited" }, 429, headers);
  const note = {
    id: crypto.randomUUID(),
    message,
    mood,
    locale,
    country: cleanText(request.cf?.country, 8) || "XX",
    reveal_count: 0,
    created_at: new Date().toISOString(),
  };
  await env.DB.prepare(`
    INSERT INTO afterglow_notes
      (id, message, mood, locale, country, fingerprint, status, reveal_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'reviewing', 0, ?)
  `).bind(note.id, note.message, note.mood, note.locale, note.country, fingerprint, note.created_at).run();
  return json({ ok: true, stored: true, moderation: "reviewing", note: { ...publicAfterglowNote(note), moderation: "reviewing" } }, 202, headers);
}

async function revealAfterglow(request, env, headers, noteId) {
  if (!/^[0-9a-f-]{30,40}$/i.test(noteId)) return json({ ok: false, error: "not_found" }, 404, headers);
  const fingerprint = await afterglowFingerprint(request, env);
  const createdAt = new Date().toISOString();
  const insert = await env.DB.prepare(`
    INSERT OR IGNORE INTO afterglow_reveals (note_id, fingerprint, created_at)
    SELECT id, ?, ? FROM afterglow_notes WHERE id = ? AND status = 'visible'
  `).bind(fingerprint, createdAt, noteId).run();
  if (Number(insert.meta?.changes || 0) > 0) {
    await env.DB.prepare("UPDATE afterglow_notes SET reveal_count = reveal_count + 1 WHERE id = ?").bind(noteId).run();
  }
  const note = await env.DB.prepare(`
    SELECT id, message, mood, locale, country, reveal_count, created_at, 1 AS viewer_revealed
    FROM afterglow_notes WHERE id = ? AND status = 'visible'
  `).bind(noteId).first();
  if (!note) return json({ ok: false, error: "not_found" }, 404, headers);
  return json({ ok: true, note: publicAfterglowNote(note, fingerprint) }, 200, headers);
}

function installerInfo(value) {
  try {
    const url = new URL(value);
    if (url.origin !== "https://github.com" || url.username || url.password || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/Quartzsyr\/MuseFilm\/releases\/download\/([^/]+)\/([^/]+)$/i);
    if (!match) return null;
    const name = decodeURIComponent(match[2]);
    const tag = decodeURIComponent(match[1]);
    const platform = /\.(exe|msi|msix)$/i.test(name) ? "windows"
      : /\.(dmg|pkg)$/i.test(name) || (/\.zip$/i.test(name) && /mac|darwin|osx/i.test(`${name} ${tag}`)) ? "mac" : null;
    return platform ? { url: url.href, name: cleanText(name, 240), tag: cleanText(tag, 100), platform } : null;
  } catch { return null; }
}

function operatingSystem(agent) {
  if (/iPhone|iPad|iPod/.test(agent)) return "iOS/iPadOS";
  if (/Android/.test(agent)) return "Android";
  if (/Windows/.test(agent)) return "Windows";
  if (/Macintosh|Mac OS/.test(agent)) return "macOS";
  if (/Linux/.test(agent)) return "Linux";
  return "Other";
}

function downloadEmailConfigured(env) {
  return Boolean(env.EMAIL && (env.DOWNLOAD_TO_EMAIL || env.FEEDBACK_TO_EMAIL) && env.FEEDBACK_FROM_EMAIL);
}

function downloadEmailContent(event) {
  const rows = [
    ["事件", "网站下载点击（不代表 GitHub 已完成下载）"],
    ["自愿分享的邮箱", event.contact_email || "未分享"],
    ["安装包", event.asset_name], ["版本", event.release_tag], ["下载平台", event.platform],
    ["IP", event.ip_address], ["大致位置（IP 推测）", [event.country, event.region, event.city].filter(Boolean).join(" / ") || "未知"],
    ["时区", event.timezone], ["网络运营商", event.network], ["访问系统", event.operating_system],
    ["浏览器", event.browser], ["浏览器信息", event.user_agent], ["语言", event.locale],
    ["来源域名", event.referrer_host], ["点击时间（UTC）", event.created_at], ["下载地址", event.download_url], ["事件编号", event.id],
  ];
  return {
    text: rows.map(([label, value]) => `${label}: ${value || "未知"}`).join("\n"),
    html: `<!doctype html><html lang="zh-CN"><body style="margin:0;padding:28px;background:#10100f;color:#eee;font-family:Arial,'PingFang SC',sans-serif"><main style="max-width:660px;margin:auto"><p style="color:#d8a85f">MUSEFILM · DOWNLOAD CLICK</p><h1>有人点击了 ${escapeHtml(event.platform === "mac" ? "macOS" : "Windows")} 下载</h1><p>这是网站下载点击通知，不能确认安装包是否下载完成。位置来自 IP 推测，可能受代理或移动网络影响。</p><table style="width:100%;border-collapse:collapse">${rows.map(([label, value]) => `<tr><th style="text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #333;white-space:nowrap">${escapeHtml(label)}</th><td style="padding:12px;border-bottom:1px solid #333;word-break:break-all">${escapeHtml(value || "未知")}</td></tr>`).join("")}</table><p style="color:#999">此通知包含访问者网络信息，请仅用于下载统计和问题排查。</p></main></body></html>`,
  };
}

async function deliverDownloadEmail(env, event) {
  let status = "not_configured";
  if (downloadEmailConfigured(env)) {
    try {
      await env.EMAIL.send({
        to: env.DOWNLOAD_TO_EMAIL || env.FEEDBACK_TO_EMAIL,
        from: env.FEEDBACK_FROM_EMAIL,
        subject: `[MuseFilm] ${event.platform === "mac" ? "macOS" : "Windows"} 下载点击 · ${event.country || "地区未知"}`,
        ...downloadEmailContent(event),
      });
      status = "sent";
    } catch {
      status = "failed";
      console.error(JSON.stringify({ message: "download notification failed", eventId: event.id }));
    }
  }
  await env.DB.prepare("UPDATE download_events SET email_status = ? WHERE id = ?").bind(status, event.id).run();
}

async function recordDownload(request, env, headers, ctx) {
  const body = await readJson(request, 4096);
  const installer = installerInfo(body.downloadUrl);
  if (!installer || body.noticeVersion !== "2026-10-19") return json({ ok: false, error: "invalid_download" }, 400, headers);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if ((body.email !== undefined && typeof body.email !== "string") || !validEmail(email) || (body.subscribe === true && (!email || ![CONSENT_VERSION, DIRECT_CONSENT_VERSION].includes(body.consentVersion)))) return json({ ok: false, error: "invalid_email" }, 400, headers);
  const fingerprint = await feedbackFingerprint(request, env);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM download_events WHERE fingerprint = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')").bind(fingerprint).first();
  if (Number(recent?.count || 0) >= 30) return json({ ok: false, error: "rate_limited" }, 429, headers);
  const eventId = cleanText(body.eventId, 100) || crypto.randomUUID();
  const agent = cleanText(request.headers.get("User-Agent"), 600);
  const event = {
    id: await sha256(`${fingerprint}:${eventId}`), fingerprint,
    platform: installer.platform, download_url: installer.url, asset_name: installer.name, release_tag: installer.tag,
    // Only trust Cloudflare's connection and geolocation fields, never body-supplied IPs.
    ip_address: clientIp(request), country: cleanText(request.cf?.country, 8),
    region: cleanText(request.cf?.region, 100), city: cleanText(request.cf?.city, 100),
    timezone: cleanText(request.cf?.timezone, 80), network: cleanText(request.cf?.asOrganization, 160),
    operating_system: operatingSystem(agent), browser: browserFamily(agent), user_agent: agent,
    locale: cleanText(body.locale, 20), referrer_host: cleanText(body.referrerHost, 160), created_at: new Date().toISOString(),
  };
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO download_events
    (id, fingerprint, platform, download_url, asset_name, release_tag, ip_address, country, region, city, timezone, network, operating_system, browser, user_agent, locale, referrer_host, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(...Object.values(event)).run();
  if (!Number(result.meta?.changes || 0)) return json({ ok: true, recorded: false, emailQueued: false }, 202, headers);
  const contact = email ? await saveDownloadContact(env, { ...body, email }, event) : null;
  event.contact_email = email;
  const promise = Promise.all([deliverDownloadEmail(env, event), sendThankYou(env, contact)]);
  if (ctx?.waitUntil) ctx.waitUntil(promise);
  else await promise;
  return json({ ok: true, recorded: true, emailQueued: downloadEmailConfigured(env), ...(email ? { thankYouQueued: Boolean(contact?.mailId && communityMailReady(env)) } : {}) }, 202, headers);
}

async function adminDownloads(request, env, headers) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401, headers);
  const result = await env.DB.prepare("SELECT d.*,s.email AS contact_email FROM download_events d LEFT JOIN subscriber_downloads m ON d.id=m.download_id LEFT JOIN subscribers s ON s.id=m.subscriber_id ORDER BY d.created_at DESC LIMIT 100").all();
  return json({ ok: true, downloads: result.results || [] }, 200, headers);
}

async function secureEqual(left, right) {
  if (!left || !right) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const first = new Uint8Array(a), second = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < first.length; i += 1) difference |= first[i] ^ second[i];
  return difference === 0;
}

async function adminAuthorized(request, env) {
  if (await hasAdminSession(request, env)) return true;
  const supplied = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  return secureEqual(supplied, env.ADMIN_TOKEN || "");
}

async function adminStats(request, env, headers) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401, headers);
  const [totals, daily, pages, platforms, feedback] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS page_views, COUNT(DISTINCT fingerprint) AS unique_visitors FROM visit_events"),
    env.DB.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS page_views, COUNT(DISTINCT fingerprint) AS unique_visitors FROM visit_events WHERE created_at >= datetime('now','-30 days') GROUP BY day ORDER BY day DESC`),
    env.DB.prepare("SELECT path, COUNT(*) AS page_views FROM visit_events GROUP BY path ORDER BY page_views DESC LIMIT 20"),
    env.DB.prepare("SELECT platform, COUNT(*) AS page_views FROM visit_events GROUP BY platform ORDER BY page_views DESC"),
    env.DB.prepare("SELECT status, COUNT(*) AS count FROM feedback GROUP BY status"),
  ]);
  return json({
    ok: true,
    totals: totals.results?.[0] || { page_views: 0, unique_visitors: 0 },
    daily: daily.results || [],
    pages: pages.results || [],
    platforms: platforms.results || [],
    feedback: feedback.results || [],
  }, 200, headers);
}

async function adminFeedback(request, env, headers) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401, headers);
  const result = await env.DB.prepare(`
    SELECT id, type, message, contact_email, page_url, locale, platform, country, browser, status, email_status, created_at
    FROM feedback
    ORDER BY created_at DESC
    LIMIT 100
  `).all();
  return json({ ok: true, feedback: result.results || [] }, 200, headers);
}

async function adminAfterglow(request, env, headers) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401, headers);
  const result = await env.DB.prepare(`
    SELECT id, message, mood, locale, country, status, reveal_count, created_at
    FROM afterglow_notes
    ORDER BY CASE status WHEN 'reviewing' THEN 0 WHEN 'visible' THEN 1 ELSE 2 END, created_at DESC
    LIMIT 200
  `).all();
  return json({ ok: true, notes: result.results || [] }, 200, headers);
}

async function moderateAfterglow(request, env, headers, noteId) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401, headers);
  const body = await readJson(request, 2048);
  const status = body.status === "visible" ? "visible" : (body.status === "hidden" ? "hidden" : "");
  if (!status) return json({ ok: false, error: "invalid_status" }, 400, headers);
  const result = await env.DB.prepare("UPDATE afterglow_notes SET status = ? WHERE id = ? AND status IN ('reviewing','visible','hidden')").bind(status, noteId).run();
  if (Number(result.meta?.changes || 0) < 1) return json({ ok: false, error: "not_found" }, 404, headers);
  return json({ ok: true, id: noteId, status }, 200, headers);
}

async function handleRequest(request, env, ctx) {
  const communityResponse = await handleCommunity(request, env, ctx);
  if (communityResponse) return communityResponse;
  const url = new URL(request.url);
  const headers = corsHeaders(request, env);
  const afterglowRevealMatch = url.pathname.match(/^\/api\/afterglow\/([0-9a-f-]{30,40})\/reveal$/i);
  const afterglowModerationMatch = url.pathname.match(/^\/api\/admin\/afterglow\/([0-9a-f-]{30,40})$/i);
  const isPublicApi = PUBLIC_API_PATHS.has(url.pathname) || Boolean(afterglowRevealMatch);
  if ((isPublicApi || request.method === "OPTIONS") && !originAllowed(request, env)) {
    return json({ ok: false, error: "origin_not_allowed" }, 403);
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (url.pathname === "/api/config" && request.method === "GET") {
    return json({
      ok: true,
      turnstileEnabled: Boolean(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY),
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
      downloadNotificationsEnabled: downloadEmailConfigured(env),
    }, 200, headers);
  }
  if (url.pathname === "/api/visit" && request.method === "POST") return recordVisit(request, env, headers);
  if (url.pathname === "/api/visitors" && request.method === "GET") return publicVisitorCount(env, headers);
  if (url.pathname === "/api/download" && request.method === "POST") return recordDownload(request, env, headers, ctx);
  if (url.pathname === "/api/feedback" && request.method === "POST") return submitFeedback(request, env, headers, ctx);
  if (url.pathname === "/api/afterglow" && request.method === "GET") return listAfterglow(request, env, headers);
  if (url.pathname === "/api/afterglow" && request.method === "POST") return submitAfterglow(request, env, headers);
  if (afterglowRevealMatch && request.method === "POST") return revealAfterglow(request, env, headers, afterglowRevealMatch[1]);
  if (url.pathname === "/api/admin/stats" && request.method === "GET") return adminStats(request, env, headers);
  if (url.pathname === "/api/admin/feedback" && request.method === "GET") return adminFeedback(request, env, headers);
  if (url.pathname === "/api/admin/downloads" && request.method === "GET") return adminDownloads(request, env, headers);
  if (url.pathname === "/api/admin/afterglow" && request.method === "GET") return adminAfterglow(request, env, headers);
  if (afterglowModerationMatch && request.method === "PATCH") return moderateAfterglow(request, env, headers, afterglowModerationMatch[1]);
  if (url.pathname === "/health" && request.method === "GET") {
    await env.DB.prepare("SELECT 1").first();
    return json({ ok: true, service: "musefilm-feedback-api" }, 200, headers);
  }
  return json({ ok: false, error: "not_found" }, 404, headers);
}

// BEGIN GENERATED COMMUNITY
const ADMIN_PAGE_HTML = "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"color-scheme\" content=\"dark\"><title>MuseFilm · 管理后台</title>\n<style>\n:root{color-scheme:dark;--bg:#0c0e11;--panel:#12151a;--panel-hover:#181c22;--line:#282d35;--text:#eef0f2;--muted:#929ba8;--accent:#cd6858;--soft:#cd685817;--green:#94bfa5;--blue:#9aaed0;--orange:#d6b282;--red:#e59d93;font-family:Inter,-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;font-synthesis:none}\n*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-size:13px;line-height:1.6}button,input,select,textarea{font:inherit}button,a.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:9px 13px;min-height:37px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text);text-decoration:none;cursor:pointer;white-space:nowrap}button:hover,a.button:hover{background:var(--panel-hover);border-color:#49515e}button:disabled{opacity:.5;cursor:wait}button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:550}button.primary:hover{background:#db7867}button.quiet{background:transparent;color:var(--muted)}button.danger{color:var(--red)}button.small{padding:5px 10px;min-height:30px;font-size:12px}button.text{padding:2px 0;min-height:24px;background:none;border:0;color:var(--muted)}a{color:#d9a390;text-decoration:none}a:hover{text-decoration:underline}button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}svg.icon{width:17px;height:17px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}input,select,textarea{display:block;width:100%;border:1px solid var(--line);border-radius:8px;background:#0e1115;color:var(--text);padding:10px 12px;outline:none}input:focus,select:focus,textarea:focus{border-color:#a16a5b}input[aria-invalid=true],textarea[aria-invalid=true]{border-color:var(--red)}input::placeholder,textarea::placeholder{color:#616c7b}input[type=checkbox],input[type=radio]{width:16px;height:16px;padding:0;accent-color:var(--accent);flex-shrink:0}textarea{resize:vertical;line-height:1.8}label{display:block;color:#c3c9d2;font-size:12px;margin-bottom:7px}h1,h2,h3,p{margin:0}h1{font-size:25px;line-height:1.35;letter-spacing:-.04em;font-weight:600}h2{font-size:16px;font-weight:550;letter-spacing:-.02em}h3{font-size:14px;font-weight:550}.muted,small{color:var(--muted)}small{font-size:11px}strong{font-weight:550}[hidden]{display:none!important}.logo{display:flex;align-items:center;gap:10px;color:var(--text);font-size:17px;font-weight:550;letter-spacing:-.04em}.logo-mark{width:30px;height:30px;display:grid;place-items:center;border:1px solid #805044;border-radius:8px;color:#edbcac;background:#31211f}.logo-mark svg{width:18px;height:18px}.eyebrow{font-size:10px;letter-spacing:.15em;color:#a8877f}.shell{display:grid;grid-template-columns:204px minmax(0,1fr);min-height:100svh}.sidebar{position:sticky;top:0;height:100svh;display:flex;flex-direction:column;border-right:1px solid var(--line);padding:25px 16px;background:#101216}.sidebar .logo{padding:0 9px}.sidebar-caption{margin:8px 0 30px 49px;font-size:10px;color:#647080;letter-spacing:.1em}.nav{display:grid;gap:5px}.nav button{justify-content:flex-start;background:none;border-color:transparent;color:var(--muted);padding:11px 13px;gap:11px;font-size:13px}.nav button[aria-current=page]{background:var(--soft);border-color:#cd685829;color:#edb0a4}.nav .nav-count{margin-left:auto;font-size:10px;background:#323039;border-radius:5px;padding:0 5px}.sidebar-footer{margin-top:auto;border-top:1px solid var(--line);padding:18px 9px 0;display:grid;gap:15px}.sidebar-footer a,.sidebar-footer button{font-size:12px;justify-content:flex-start}.sidebar-footer small{color:#67717f;font-size:10px}.main{min-width:0}.topbar{height:65px;border-bottom:1px solid var(--line);padding:0 30px;display:flex;justify-content:space-between;align-items:center;gap:16px;background:#0e1114}.breadcrumb{display:flex;gap:10px;align-items:center;color:#738090;font-size:12px}.breadcrumb strong{font-weight:450;color:#d1d5dc}.topbar-right{display:flex;gap:16px;align-items:center}.sync{font-size:10px;color:#697583}.content{padding:28px 30px 40px;max-width:1460px;margin:auto}.page-heading{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:25px}.page-heading p{margin-top:5px;font-size:12px;color:var(--muted)}.inline-actions{display:flex;align-items:center;flex-wrap:wrap;gap:9px}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:22px}.stat{padding:18px 20px;border:1px solid var(--line);border-radius:11px;background:var(--panel);text-align:left;display:block;color:var(--text);white-space:normal;min-height:122px}.stat-label{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted)}.stat-number{display:block;font-size:31px;font-weight:500;line-height:1.35;margin:9px 0 2px;letter-spacing:-.04em;font-variant-numeric:tabular-nums}.stat small{font-size:10px;color:#697687}.overview-grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(260px,1fr);gap:20px;margin-bottom:22px}.panel{border:1px solid var(--line);border-radius:11px;background:var(--panel);min-width:0}.panel-pad{padding:21px}.panel-heading{display:flex;justify-content:space-between;gap:15px;align-items:center;margin-bottom:20px}.panel-heading p{color:var(--muted);font-size:11px;margin-top:3px}.legend{display:flex;gap:13px;font-size:10px;color:var(--muted)}.legend span{display:flex;gap:6px;align-items:center}.dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);flex-shrink:0}.dot.blue{background:#778fab}.dot.green{background:#80ab92}.chart{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:12px;height:155px;margin:25px 0 4px}.chart-day{display:flex;flex-direction:column;align-items:center;gap:10px;min-width:0}.chart-bars{height:126px;width:100%;display:flex;align-items:flex-end;justify-content:center;gap:5px;border-bottom:1px solid var(--line);position:relative}.chart-bar{width:clamp(7px,1.6vw,18px);height:var(--height);min-height:2px;border-radius:3px 3px 0 0;background:var(--accent)}.chart-bar.secondary{background:#667b98}.chart-day small{font-size:10px;color:#768394}.health-list{display:grid;gap:0}.health-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid #222831;font-size:12px}.health-row:last-child{border:0}.health-value{display:flex;align-items:center;gap:7px;color:var(--green);font-size:11px}.health-value.warning{color:var(--orange)}.attention-note{padding:12px 14px;margin-top:15px;background:#d6b2820a;border:1px solid #d6b28220;border-radius:8px;color:var(--orange);font-size:12px}.table-wrap{overflow:auto;border-radius:11px;min-width:0}.table-wrap.bordered{border:1px solid var(--line);background:var(--panel)}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px;white-space:nowrap}th{font-weight:450;color:#7d8999;font-size:11px;padding:12px 18px;background:#101318;border-bottom:1px solid var(--line)}td{padding:15px 18px;border-bottom:1px solid #222730}tbody tr:last-child td{border:0}td small{display:block;margin-top:3px;font-size:10px}td.subject-cell{max-width:380px;white-space:normal;min-width:180px}td.subject-cell strong{display:block;overflow-wrap:anywhere}td.break{white-space:normal;min-width:180px;overflow-wrap:anywhere}.badge{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;line-height:1.5;border-radius:5px;background:#262c34;color:#a9b3c0;font-size:10px;white-space:nowrap}.badge.good{background:#8ab19c12;color:var(--green)}.badge.wait{background:#d6b28212;color:var(--orange)}.badge.bad{background:#e59d9312;color:var(--red)}.badge.info{background:#9aaed012;color:var(--blue)}.empty{padding:44px 22px;text-align:center;color:var(--muted);font-size:12px;white-space:normal}.empty strong{display:block;color:#c6cdd6;margin-bottom:6px;font-size:13px;font-weight:450}.filters{display:flex;align-items:center;gap:10px;margin-bottom:17px;flex-wrap:wrap}.filters input{flex:1;min-width:180px}.filters select{width:auto;min-width:115px}.segmented{display:inline-flex;gap:3px;flex-wrap:wrap;padding:3px;background:#111419;border:1px solid var(--line);border-radius:9px}.segmented button{padding:5px 12px;min-height:30px;background:none;border-color:transparent;color:#8793a3;font-size:12px}.segmented button[aria-pressed=true]{background:#272c35;color:var(--text)}.section-tools{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap;margin-bottom:18px}.section-tools .search{max-width:280px;width:100%}.pagination{display:flex;justify-content:space-between;align-items:center;gap:14px;font-size:11px;color:var(--muted);margin-top:16px}.note{font-size:11px;color:var(--muted);margin-top:13px;line-height:1.8}.banner{border:1px solid #5d4938;background:#292014;color:#d8be94;padding:12px 16px;border-radius:8px;font-size:12px;margin-bottom:19px}.banner.error{border-color:#6d3a37;background:#2b1c1c;color:var(--red)}.banner.local{background:#10231c;border-color:#2a5140;color:#a6ccb6}.page-error{display:flex;align-items:center;justify-content:space-between;gap:14px}.composer-heading{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-bottom:18px}.composer-heading .title{display:flex;align-items:center;gap:12px}.compose-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.8fr);gap:22px}.form-fields{display:grid;gap:20px}.field-help{color:#788594;font-size:11px;margin-top:6px;line-height:1.7}.field-error{color:var(--red);font-size:11px;margin-top:5px;min-height:0}.field-heading{display:flex;justify-content:space-between;align-items:baseline}.field-heading small{font-size:10px}.radio-options{display:flex;gap:22px;margin-bottom:11px}.radio-options label{display:flex;gap:8px;align-items:center;margin:0}.schedule-input{max-width:320px}.compose-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:18px 21px;border-top:1px solid var(--line)}.save-state{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px}.save-state.dirty{color:var(--orange)}.preview-frame{width:100%;height:355px;border:0;border-radius:8px;background:#090909;display:block}.preview-placeholder{height:300px;border:1px dashed #303640;border-radius:8px;display:grid;place-items:center;color:#6e7987;text-align:center;font-size:12px;padding:30px}.preview-status{display:flex;gap:8px;align-items:center;margin-top:15px;line-height:1.8;font-size:11px;color:var(--muted)}.preview-status .icon{color:var(--orange)}.compose-summary{display:grid;gap:10px;font-size:12px;margin-top:20px;padding-top:16px;border-top:1px solid var(--line)}.compose-summary>div{display:flex;justify-content:space-between;gap:12px}.compose-summary span{color:var(--muted)}.compose-summary strong{font-weight:450}.status-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px}.detail-stats{display:flex;gap:23px;flex-wrap:wrap;margin:17px 0 22px}.detail-stats>div{font-size:11px;color:var(--muted)}.detail-stats b{display:block;font-size:22px;font-weight:450;color:var(--text);margin-top:3px}.delivery-table td{white-space:normal;overflow-wrap:anywhere;min-width:120px}.detail-meta{display:flex;gap:18px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-top:7px}.details-section{margin-top:22px}.details-section summary{cursor:pointer;color:#acb6c4;font-size:12px;padding:14px 0}.attempt-item{padding:9px 0;border-bottom:1px solid var(--line);font-size:11px;color:var(--muted)}.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:23px}.setting-row{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:14px 0;border-bottom:1px solid #222730}.setting-row:last-child{border:0}.setting-row label{margin:0;color:var(--text);font-size:12px;cursor:pointer}.setting-row small{display:block;margin-top:4px;max-width:360px;line-height:1.8}.switch{width:32px!important;height:18px!important;appearance:none;border-radius:99px;background:#333b47!important;border:0!important;position:relative;cursor:pointer;flex-shrink:0}.switch:before{content:'';position:absolute;left:3px;top:3px;width:12px;height:12px;border-radius:50%;background:#adb5c2;transition:transform .15s}.switch:checked{background:var(--accent)!important}.switch:checked:before{background:white;transform:translateX(14px)}.settings-meta{margin-top:18px;font-size:11px;color:var(--muted);line-height:1.9;display:grid;gap:7px}.settings-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px;flex-wrap:wrap}.settings-footer{display:flex;justify-content:space-between;align-items:center;gap:15px;margin:-3px 0 25px}.feedback-card{padding:18px 20px;border-bottom:1px solid var(--line)}.feedback-card:last-child{border:0}.feedback-top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px}.feedback-meta{display:flex;gap:9px;flex-wrap:wrap;align-items:center;color:var(--muted);font-size:11px}.feedback-body{white-space:pre-wrap;overflow-wrap:anywhere;color:#d4dae2;line-height:1.8;font-size:13px}.feedback-bottom{display:flex;justify-content:space-between;align-items:center;margin-top:15px;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--muted)}.feedback-bottom select{width:auto;padding:5px 9px;font-size:11px}.login{min-height:100svh;display:grid;place-items:center;padding:25px;background:radial-gradient(ellipse at top right,#59372a21,transparent 55%)}.login-card{max-width:410px;width:100%;padding:32px;border:1px solid var(--line);border-radius:15px;background:var(--panel)}.login-card h1{font-size:24px;margin-top:28px}.login-card>p{font-size:12px;line-height:1.8;color:var(--muted);margin-top:10px}.login-card form{display:grid;gap:17px;margin-top:24px}.code-row{display:grid;grid-template-columns:1fr auto;gap:9px}.code-row input{letter-spacing:.12em;font-variant-numeric:tabular-nums}.login-error{font-size:12px;color:var(--red);line-height:1.8}.login-note{font-size:11px;color:var(--muted);line-height:1.8}.loading-line{height:2px;background:var(--accent);width:100%;position:fixed;left:0;top:0;z-index:100;opacity:.7;animation:loading 1s ease-in-out infinite}@keyframes loading{50%{opacity:.15}}dialog{margin:auto;width:min(510px,calc(100vw - 30px));max-height:calc(100svh - 36px);padding:0;border:1px solid #424954;border-radius:14px;background:#15191f;color:var(--text);box-shadow:0 35px 120px #0008}dialog::backdrop{background:#030507b3;backdrop-filter:blur(4px)}.dialog-head{padding:23px 24px 13px;display:flex;justify-content:space-between;align-items:center;gap:12px}.dialog-body{padding:4px 24px 24px}.dialog-body>p{font-size:12px;color:var(--muted);line-height:1.8}.dialog-footer{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;padding:17px 24px;border-top:1px solid var(--line)}.review-grid{margin:18px 0;display:grid;gap:13px}.review-grid>div{display:flex;justify-content:space-between;gap:20px;font-size:12px}.review-grid span{color:var(--muted)}.review-grid strong{text-align:right;overflow-wrap:anywhere}.review-test{padding:12px 14px;border:1px solid #564335;background:#2a2218;border-radius:8px;color:#ddbf97;font-size:12px;line-height:1.8}.review-test.good{background:#14221b;border-color:#2d4938;color:var(--green)}.dialog-error{font-size:12px;color:var(--red);margin-top:12px;line-height:1.8}.toast{position:fixed;right:25px;bottom:24px;z-index:200;max-width:min(430px,calc(100vw - 32px));padding:13px 18px;border:1px solid #44534a;background:#1c2721;border-radius:9px;box-shadow:0 16px 50px #0006;color:#c3dbcb;font-size:12px;line-height:1.8}.toast.error{border-color:#65413c;background:#2b211e;color:var(--red)}\n@media(min-width:1500px){.content{padding-top:32px}.chart{height:170px}.chart-bars{height:140px}}\n@media(max-width:1100px){.overview-grid{grid-template-columns:minmax(0,1.2fr) minmax(240px,1fr)}.compose-grid{grid-template-columns:minmax(0,1fr)}.compose-preview{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,.6fr);gap:20px}.preview-section{min-width:0}.compose-preview .panel-heading{grid-column:1/-1;margin:0}.compose-summary{margin-top:0;padding-top:0;border:0;align-content:start}.settings-grid{grid-template-columns:1fr}.sync{display:none}.stat{padding:17px 15px}.content{padding:24px}}\n@media(max-width:800px){.shell{display:block}.sidebar{position:relative;height:auto;padding:14px 18px 0;border-right:0;border-bottom:1px solid var(--line);display:block}.sidebar .logo{padding:0;font-size:16px}.sidebar-caption{display:none}.sidebar-footer{position:absolute;right:18px;top:14px;margin:0;padding:0;border:0;display:flex;gap:18px;align-items:center}.sidebar-footer small{display:none}.sidebar-footer button,.sidebar-footer a{font-size:11px;min-height:30px;padding:3px 0}.nav{display:flex;justify-content:space-between;gap:4px;margin-top:16px;padding-bottom:10px}.nav button{flex:1;justify-content:center;padding:8px 6px;gap:6px;font-size:12px;min-width:0}.nav .nav-count{display:none}.nav svg{width:15px;height:15px}.topbar{height:52px;padding:0 20px}.content{padding:22px 20px 32px}.topbar-right{gap:10px}.stats{gap:10px;grid-template-columns:repeat(2,minmax(0,1fr))}.stat{min-height:107px}.stat-number{font-size:28px}.overview-grid{grid-template-columns:1fr}.chart{height:150px}.chart-bar{width:16px}.page-heading{align-items:flex-start}.page-heading h1{font-size:23px}.panel-pad{padding:18px}.compose-preview{display:block}.compose-preview .panel-heading{margin-bottom:17px}.compose-summary{margin-top:17px;border-top:1px solid var(--line);padding-top:16px}.compose-footer{padding:15px 18px}.filters{gap:8px}.filters input{flex-basis:100%}.filters select{flex:1}.filters button{flex-shrink:0}.settings-footer{align-items:flex-start}.section-tools{gap:12px}.section-tools .search{max-width:none}.segmented{max-width:100%}.segmented button{padding:5px 10px}.table-wrap td,.table-wrap th{padding:12px 14px}.detail-stats{gap:18px}.settings-actions{gap:10px}.login-card{padding:27px}.dialog-head{padding:20px 20px 12px}.dialog-body{padding:4px 20px 20px}.dialog-footer{padding:15px 20px}.toast{right:16px;bottom:16px}.preview-frame{height:330px}}\n@media(max-width:430px){.nav{gap:2px}.nav button{gap:4px;font-size:11px;padding:8px 3px}.nav svg{width:14px;height:14px}.topbar .breadcrumb{font-size:11px;gap:7px}.topbar-right button{padding:7px 9px;font-size:11px}.topbar-right button svg{display:none}.content{padding:20px 16px 30px}.topbar{padding:0 16px}.page-heading{gap:10px}.page-heading button{font-size:12px;padding:8px 10px}.page-heading p{font-size:11px}.compose-footer>.inline-actions{width:100%;justify-content:flex-end}.composer-heading{gap:8px}.composer-heading .title{gap:8px}.chart{gap:8px}.chart-bar{width:12px}.sidebar-footer{gap:14px}.sidebar-footer a{display:none}}\n@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}\n</style>\n</head>\n<body>\n<svg aria-hidden=\"true\" width=\"0\" height=\"0\" style=\"position:absolute;overflow:hidden\"><defs>\n<symbol id=\"i-logo\" viewBox=\"0 0 24 24\"><rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"2\"/><path d=\"M9 3v18M15 3v18M4 8h5M4 16h5M15 8h5M15 16h5\"/></symbol>\n<symbol id=\"i-home\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/></symbol>\n<symbol id=\"i-mail\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\"/><path d=\"m3 6 9 7 9-7\"/></symbol>\n<symbol id=\"i-users\" viewBox=\"0 0 24 24\"><circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-3-5\"/></symbol>\n<symbol id=\"i-activity\" viewBox=\"0 0 24 24\"><path d=\"M3 12h4l3-8 4 16 3-8h4\"/></symbol>\n<symbol id=\"i-settings\" viewBox=\"0 0 24 24\"><path d=\"M4 7h16M4 17h16\"/><circle cx=\"9\" cy=\"7\" r=\"3\"/><circle cx=\"15\" cy=\"17\" r=\"3\"/></symbol>\n<symbol id=\"i-refresh\" viewBox=\"0 0 24 24\"><path d=\"M20 11a8 8 0 1 0-2 6M20 4v7h-7\"/></symbol>\n<symbol id=\"i-plus\" viewBox=\"0 0 24 24\"><path d=\"M12 5v14M5 12h14\"/></symbol>\n<symbol id=\"i-arrow\" viewBox=\"0 0 24 24\"><path d=\"M5 12h14m-6-6 6 6-6 6\"/></symbol>\n<symbol id=\"i-back\" viewBox=\"0 0 24 24\"><path d=\"M19 12H5m6-6-6 6 6 6\"/></symbol>\n<symbol id=\"i-check\" viewBox=\"0 0 24 24\"><path d=\"m5 12 4 4L19 6\"/></symbol>\n<symbol id=\"i-clock\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/></symbol>\n<symbol id=\"i-external\" viewBox=\"0 0 24 24\"><path d=\"M14 3h7v7m0-7-11 11M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4\"/></symbol>\n<symbol id=\"i-download\" viewBox=\"0 0 24 24\"><path d=\"M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4\"/></symbol>\n<symbol id=\"i-close\" viewBox=\"0 0 24 24\"><path d=\"m6 6 12 12M18 6 6 18\"/></symbol>\n</defs></svg>\n<div id=\"loading-line\" class=\"loading-line\" hidden></div>\n<section id=\"login\" class=\"login\"><div class=\"login-card\"><div class=\"logo\"><span class=\"logo-mark\"><svg class=\"icon\"><use href=\"#i-logo\"/></svg></span>MuseFilm</div><h1>登录管理后台</h1><p>查看网站数据、管理订阅者与邮件。</p><form id=\"login-form\"><div><label for=\"login-code\">邮箱验证码</label><div class=\"code-row\"><input id=\"login-code\" name=\"code\" inputmode=\"numeric\" autocomplete=\"one-time-code\" maxlength=\"8\" placeholder=\"8 位验证码\" required><button id=\"request-code\" type=\"button\">获取验证码</button></div></div><button class=\"primary\" id=\"login-submit\" type=\"submit\">登录后台</button><p class=\"login-error\" id=\"login-message\" role=\"status\"></p><p class=\"login-note\">验证码发送至站长邮箱，10 分钟内有效。<br>登录过期后，当前页面中的邮件内容会保留。</p></form><a href=\"https://musefilm.top/\" style=\"display:inline-block;margin-top:23px;font-size:11px\">返回网站 ↗</a></div></section>\n<div id=\"dashboard\" class=\"shell\" hidden>\n<aside class=\"sidebar\"><div class=\"logo\"><span class=\"logo-mark\"><svg class=\"icon\"><use href=\"#i-logo\"/></svg></span>MuseFilm</div><p class=\"sidebar-caption\">WEBSITE ADMIN</p><nav class=\"nav\" aria-label=\"后台导航\">\n<button data-view=\"overview\" aria-current=\"page\"><svg class=\"icon\"><use href=\"#i-home\"/></svg>概览</button>\n<button data-view=\"mail\"><svg class=\"icon\"><use href=\"#i-mail\"/></svg>邮件<span class=\"nav-count\" id=\"nav-mail-count\" hidden></span></button>\n<button data-view=\"subscribers\"><svg class=\"icon\"><use href=\"#i-users\"/></svg>订阅者</button>\n<button data-view=\"activity\"><svg class=\"icon\"><use href=\"#i-activity\"/></svg>活动记录<span class=\"nav-count\" id=\"nav-feedback-count\" hidden></span></button>\n<button data-view=\"membership\"><svg class=\"icon\"><use href=\"#i-users\"/></svg>会员与充值</button>\n<button data-view=\"automation\"><svg class=\"icon\"><use href=\"#i-settings\"/></svg>自动化</button>\n</nav><div class=\"sidebar-footer\"><a href=\"https://musefilm.top/\" target=\"_blank\" rel=\"noopener\">查看网站 <svg class=\"icon\" style=\"width:12px;height:12px;vertical-align:middle\"><use href=\"#i-external\"/></svg></a><button class=\"text\" id=\"logout\">退出登录</button><small>摄影档案 · 保持联系</small></div></aside>\n<main class=\"main\"><header class=\"topbar\"><div class=\"breadcrumb\"><span>工作台</span><span>/</span><strong id=\"breadcrumb\">概览</strong></div><div class=\"topbar-right\"><span class=\"sync\" id=\"last-sync\">尚未更新</span><button class=\"quiet small\" id=\"refresh\"><svg class=\"icon\"><use href=\"#i-refresh\"/></svg>刷新</button></div></header>\n<div class=\"content\"><div class=\"banner local\" id=\"preview-banner\" hidden>本地演示环境 · 所有邮件仅保存在本机，不会实际寄出。</div><div class=\"banner error page-error\" id=\"page-error\" role=\"alert\" hidden><span id=\"page-error-text\"></span><button class=\"quiet small\" id=\"retry-load\">重新加载</button></div>\n<section id=\"view-overview\" data-panel=\"overview\"><div class=\"page-heading\"><div><h1>概览</h1><p>网站访问、订阅与邮件运行情况。</p></div><button class=\"primary\" data-new-mail><svg class=\"icon\"><use href=\"#i-plus\"/></svg>新建邮件</button></div>\n<div class=\"stats\"><div class=\"stat\"><span class=\"stat-label\">累计访问 <svg class=\"icon\"><use href=\"#i-activity\"/></svg></span><b class=\"stat-number\" id=\"metric-visits\">—</b><small>包含重复访问</small></div><button class=\"stat\" data-goto=\"activity\"><span class=\"stat-label\">下载点击 <svg class=\"icon\"><use href=\"#i-download\"/></svg></span><b class=\"stat-number\" id=\"metric-downloads\">—</b><small>最近 30 天 · 查看记录 →</small></button><button class=\"stat\" data-goto=\"subscribers\"><span class=\"stat-label\">有效订阅者 <svg class=\"icon\"><use href=\"#i-users\"/></svg></span><b class=\"stat-number\" id=\"metric-subscribers\">—</b><small>已订阅且可接收邮件 →</small></button><button class=\"stat\" data-goto=\"mail\"><span class=\"stat-label\">待发投递 <svg class=\"icon\"><use href=\"#i-clock\"/></svg></span><b class=\"stat-number\" id=\"metric-queued\">—</b><small>含预约与等待重试 →</small></button></div>\n<div class=\"overview-grid\"><div class=\"panel panel-pad\"><div class=\"panel-heading\"><div><h2>最近 7 天</h2><p>每日访问与下载点击 · 北京时间</p></div><div class=\"legend\"><span><i class=\"dot\"></i>访问</span><span><i class=\"dot blue\"></i>下载</span></div></div><div class=\"chart\" id=\"traffic-chart\" role=\"img\" aria-label=\"最近七天访问与下载数据\"></div><p class=\"note\" id=\"traffic-summary\"></p></div><div class=\"panel panel-pad\"><div class=\"panel-heading\"><h2>服务状态</h2><button class=\"text\" data-goto=\"automation\">查看设置 →</button></div><div class=\"health-list\" id=\"health-list\"></div><button class=\"attention-note\" id=\"attention-note\" data-goto=\"mail\" hidden></button></div></div>\n<div class=\"panel\"><div class=\"panel-heading\" style=\"padding:19px 20px 0;margin-bottom:17px\"><h2>最近邮件</h2><button class=\"text\" data-goto=\"mail\">查看全部 →</button></div><div class=\"table-wrap\"><table><thead><tr><th>标题</th><th>收件人</th><th>状态</th><th>更新时间</th><th></th></tr></thead><tbody id=\"recent-campaigns\"></tbody></table></div></div></section>\n<section id=\"view-mail\" data-panel=\"mail\" hidden><div id=\"mail-list-view\"><div class=\"page-heading\"><div><h1>邮件</h1><p>管理草稿、预约和已提交的邮件。</p></div><button class=\"primary\" data-new-mail><svg class=\"icon\"><use href=\"#i-plus\"/></svg>新建邮件</button></div><button class=\"quiet small\" id=\"resume-editor\" style=\"margin-bottom:15px\" hidden>继续编辑未保存的邮件 →</button><div class=\"section-tools\"><div class=\"segmented\" id=\"mail-filters\" aria-label=\"邮件状态筛选\"><button data-filter=\"all\" aria-pressed=\"true\">全部</button><button data-filter=\"draft\" aria-pressed=\"false\">草稿</button><button data-filter=\"scheduled\" aria-pressed=\"false\">预约中</button><button data-filter=\"active\" aria-pressed=\"false\">发送中</button><button data-filter=\"done\" aria-pressed=\"false\">已结束</button></div><input class=\"search\" id=\"mail-search\" aria-label=\"搜索邮件\" placeholder=\"搜索标题…\"></div><div class=\"table-wrap bordered\"><table><thead><tr><th>邮件标题</th><th>收件人</th><th>状态</th><th>发送 / 更新时间</th><th></th></tr></thead><tbody id=\"campaign-rows\"></tbody></table></div><p class=\"note\">“已提交”表示发送服务接受邮件，实际退信会在后续检查中更新。</p></div>\n<div id=\"mail-editor-view\" hidden><div class=\"composer-heading\"><div class=\"title\"><button class=\"quiet small\" data-mail-back aria-label=\"返回邮件列表\"><svg class=\"icon\"><use href=\"#i-back\"/></svg></button><h1>撰写邮件</h1></div><span class=\"badge\" id=\"editor-kind\">草稿</span></div><div class=\"compose-grid\"><div class=\"panel\"><form id=\"mail-form\" class=\"panel-pad form-fields\" novalidate><div><label for=\"mail-subject\">标题</label><input id=\"mail-subject\" name=\"subject\" maxlength=\"160\" placeholder=\"例如：MuseFilm 的本周更新\" aria-describedby=\"subject-error\"><p id=\"subject-error\" class=\"field-error\"></p></div><div><label for=\"mail-audience\">收件人</label><select id=\"mail-audience\" name=\"audience\"><option value=\"all\">全部有效订阅者</option><option value=\"windows\">Windows 用户</option><option value=\"mac\">macOS 用户</option></select><p class=\"field-help\" id=\"audience-help\">仅向已订阅且未停止投递的邮箱发送。</p></div><div><div class=\"field-heading\"><label for=\"mail-body\">正文</label><button type=\"button\" class=\"small quiet\" data-mail-action id=\"insert-mail-image\">插入图片</button><small id=\"body-count\">0 / 20,000</small></div><textarea id=\"mail-body\" name=\"body\" rows=\"10\" maxlength=\"20000\" placeholder=\"写下这次想分享的更新…&#10;&#10;空行自动分段；可插入图片，或粘贴 ![图片说明](https://图片地址)。\" aria-describedby=\"body-error\"></textarea><p id=\"body-error\" class=\"field-error\"></p><p class=\"field-help\">图片会在正文中显示。MuseFilm 官网及 GitHub 发布图会尽可能内嵌随信发送；下载失败或图片过大时保留在线图片。</p></div><div><label>发送时间</label><div class=\"radio-options\"><label><input type=\"radio\" name=\"delivery\" value=\"now\" checked>立即发送</label><label><input type=\"radio\" name=\"delivery\" value=\"later\">预约发送</label></div><div id=\"schedule-field\" hidden><label for=\"schedule-time\" class=\"muted\">选择本地时间</label><input class=\"schedule-input\" id=\"schedule-time\" name=\"schedule\" type=\"datetime-local\"><p class=\"field-help\" id=\"timezone-label\"></p></div><p class=\"field-error\" id=\"schedule-error\"></p></div></form><div class=\"compose-footer\"><span class=\"save-state\" id=\"save-state\">新邮件</span><div class=\"inline-actions\"><button type=\"button\" data-mail-action id=\"save-mail\">保存草稿</button><button type=\"button\" data-mail-action class=\"primary\" id=\"prepare-send\">检查并发送 <svg class=\"icon\"><use href=\"#i-arrow\"/></svg></button></div></div><p class=\"field-error\" id=\"editor-error\" role=\"status\" style=\"padding:0 21px 15px\" hidden></p></div>\n<aside class=\"panel panel-pad compose-preview\"><div class=\"panel-heading\"><h2>邮件预览</h2><button class=\"text\" data-mail-action id=\"preview-mail\">更新预览</button></div><div class=\"preview-section\"><div id=\"preview-placeholder\" class=\"preview-placeholder\">填写标题和正文后，查看邮件效果。</div><iframe id=\"preview-frame\" class=\"preview-frame\" title=\"邮件预览\" sandbox=\"\" hidden></iframe><div class=\"preview-status\" id=\"test-status\"><svg class=\"icon\"><use href=\"#i-clock\"/></svg><span>正式发送前，先给站长邮箱发一封测试信。</span></div><button style=\"margin-top:13px\" class=\"small\" data-mail-action id=\"test-mail\">发送测试邮件</button></div><div class=\"compose-summary\"><div><span>预计收件人</span><strong id=\"estimated-recipients\">—</strong></div><div><span>邮件样式</span><strong>MuseFilm 标准样式</strong></div><div><span>退订入口</span><strong>自动附加</strong></div><p class=\"field-help\">检查并发送会先保存当前内容、更新预览，再展示最终收件人数。</p></div></aside></div></div>\n<div id=\"mail-detail-view\" hidden><div class=\"composer-heading\"><div class=\"title\"><button class=\"quiet small\" data-mail-back aria-label=\"返回邮件列表\"><svg class=\"icon\"><use href=\"#i-back\"/></svg></button><h1>投递详情</h1></div><div class=\"inline-actions\"><button class=\"small\" id=\"duplicate-mail\">复制为新邮件</button><button class=\"quiet small\" id=\"refresh-delivery\">刷新记录</button></div></div><div class=\"panel panel-pad\"><div class=\"status-header\"><div><h2 id=\"detail-subject\"></h2><div class=\"detail-meta\" id=\"detail-meta\"></div></div><span id=\"detail-status\"></span></div><div class=\"detail-stats\" id=\"delivery-stats\"></div><div class=\"inline-actions\"><button class=\"small danger\" id=\"cancel-campaign\" hidden>取消预约</button><button class=\"small\" id=\"retry-campaign\" hidden>重试失败项</button></div><p class=\"note\" id=\"delivery-note\"></p></div><div class=\"table-wrap bordered details-section\"><table class=\"delivery-table\"><thead><tr><th>收件邮箱</th><th>投递状态</th><th>尝试次数</th><th>下次重试 / 提交时间</th><th>结果</th></tr></thead><tbody id=\"delivery-rows\"></tbody></table></div><details class=\"details-section\"><summary>查看邮件内容</summary><iframe class=\"preview-frame\" id=\"detail-frame\" title=\"已保存的邮件内容\" sandbox=\"\"></iframe></details><details class=\"details-section\"><summary>查看最近尝试记录</summary><div id=\"attempt-list\" class=\"panel panel-pad\"></div></details></div></section>\n<section id=\"view-subscribers\" data-panel=\"subscribers\" hidden><div class=\"page-heading\"><div><h1>订阅者</h1><p id=\"subscriber-summary\">管理邮箱、订阅状态与平台分组。</p></div><button id=\"export-subscribers\"><svg class=\"icon\"><use href=\"#i-download\"/></svg>导出 CSV</button></div><form class=\"filters\" id=\"subscriber-filters\"><input name=\"q\" aria-label=\"搜索邮箱\" placeholder=\"搜索邮箱…\"><select name=\"status\" aria-label=\"筛选订阅状态\"><option value=\"\">全部状态</option><option value=\"subscribed\">已订阅</option><option value=\"pending\">待确认（旧流程）</option><option value=\"contact\">仅留邮箱</option><option value=\"unsubscribed\">已退订</option></select><select name=\"platform\" aria-label=\"筛选下载平台\"><option value=\"\">全部平台</option><option value=\"mac\">macOS</option><option value=\"windows\">Windows</option></select><button type=\"submit\">筛选</button><button type=\"button\" class=\"quiet\" id=\"reset-subscribers\">重置</button></form><div class=\"table-wrap bordered\"><table><thead><tr><th>邮箱</th><th>订阅状态</th><th>平台</th><th>感谢邮件</th><th>最近下载</th><th>操作</th></tr></thead><tbody id=\"subscriber-rows\"></tbody></table></div><div class=\"pagination\"><span id=\"subscriber-page\"></span><div class=\"inline-actions\"><button class=\"small quiet\" id=\"previous-page\">上一页</button><button class=\"small quiet\" id=\"next-page\">下一页</button></div></div><p class=\"note\">新下载者填写邮箱即订阅；历史待确认记录继续保留原状态。停止发信和退信抑制都会在正式投递前再次检查。</p></section>\n<section id=\"view-activity\" data-panel=\"activity\" hidden><div class=\"page-heading\"><div><h1>活动记录</h1><p>查看最近下载点击和网站反馈。</p></div></div><div class=\"section-tools\"><div class=\"segmented\" id=\"activity-tabs\" aria-label=\"活动类型\"><button data-activity=\"downloads\" aria-pressed=\"true\">下载点击</button><button data-activity=\"feedback\" aria-pressed=\"false\">用户反馈</button></div><input class=\"search\" id=\"activity-search\" aria-label=\"搜索活动记录\" placeholder=\"搜索安装包、邮箱或反馈…\"></div><div id=\"downloads-panel\"><div class=\"table-wrap bordered\"><table><thead><tr><th>时间</th><th>安装包 / 邮箱</th><th>设备</th><th>IP / 地区</th><th>站长提醒</th></tr></thead><tbody id=\"download-rows\"></tbody></table></div><p class=\"note\">展示最近 100 条点击记录；点击不代表完成下载，IP 位置为推测值。</p></div><div id=\"feedback-panel\" hidden><div class=\"panel\" id=\"feedback-list\"></div><p class=\"note\">展示最近 100 条反馈，可修改处理状态。</p></div></section>\n<section id=\"view-membership\" data-panel=\"membership\" hidden>\n<div class=\"page-heading\"><div><h1>会员与充值</h1><p>爱发电订单核验、到账提醒与兑换码，统一管理。</p></div><button class=\"quiet\" id=\"member-reload\">刷新会员数据</button></div>\n<div class=\"stats\"><div class=\"stat\"><span class=\"stat-label\">账号总数</span><b class=\"stat-number\" id=\"member-total\">—</b><small>Cloudflare 账号</small></div><div class=\"stat\"><span class=\"stat-label\">有效付费会员</span><b class=\"stat-number\" id=\"member-active\">—</b><small>按账号去重，不含试用</small></div><div class=\"stat\"><span class=\"stat-label\">已核验订单总额</span><b class=\"stat-number\" id=\"member-amount\">—</b><small>已知金额，不含撤销订单；未扣平台费用</small></div><div class=\"stat\"><span class=\"stat-label\">通知待处理</span><b class=\"stat-number\" id=\"member-attention\">—</b><small>失败、发送中或结果待核实</small></div></div>\n<div class=\"panel panel-pad\" style=\"margin-bottom:22px\"><div class=\"inline-actions\" style=\"justify-content:space-between\"><div><h2>充值到账邮件</h2><p class=\"muted\" id=\"member-mail-config\">正在读取配置…</p></div><button id=\"member-notifications\" disabled>加载中…</button></div><p class=\"note\">只通知启用后新核验的付费订单，同一订单只提交一次；历史恢复和零元兑换不会补发到账邮件。失败记录可重试，投递结果不确定时需先核对收件箱。</p></div>\n<div class=\"segmented\" id=\"member-tabs\" style=\"margin-bottom:20px\"><button data-member-tab=\"orders\" aria-pressed=\"true\">充值订单</button><button data-member-tab=\"codes\" aria-pressed=\"false\">兑换码</button><button data-member-tab=\"accounts\" aria-pressed=\"false\">账号资料</button><button data-member-tab=\"gifts\" aria-pressed=\"false\">爱发电关联审核</button><button data-member-tab=\"messages\" aria-pressed=\"false\">客户端消息</button><button data-member-tab=\"reports\" aria-pressed=\"false\">底片漂流举报</button></div>\n<div data-member-panel=\"orders\"><div class=\"table-wrap bordered\"><table><thead><tr><th>订单 / 账号</th><th>产品 / 金额</th><th>核验时间</th><th>权益状态</th><th>到账邮件</th><th>操作</th></tr></thead><tbody id=\"member-orders\"><tr><td colspan=\"6\" class=\"empty\">加载中…</td></tr></tbody></table></div><p class=\"note\">最近 100 笔核验记录。核验订单不代表权益已完成同步；以账号关联和订单进度为准。金额以爱发电服务端数据为准。</p></div>\n<div data-member-panel=\"codes\" hidden><form id=\"member-create\" class=\"panel panel-pad\" style=\"margin-bottom:20px\"><div class=\"panel-heading\"><div><h2>生成兑换码</h2><p>兑换后绑定用户账号，同档会员从原有效期后顺延。</p></div><button class=\"primary\" type=\"submit\">生成一批</button></div><div class=\"settings-grid\"><div><label for=\"member-product\">产品</label><select id=\"member-product\" name=\"product\"><option value=\"plus\">Plus 会员</option><option value=\"pro\">Pro 会员</option><option value=\"bookDocument\">光页成册券</option><option value=\"bookMotion\">光页影像券</option></select></div><div><label for=\"member-count\">数量（1–100）</label><input id=\"member-count\" name=\"count\" type=\"number\" min=\"1\" max=\"100\" value=\"10\" required></div><div><label for=\"member-days\">会员天数（创作券不使用）</label><input id=\"member-days\" name=\"durationDays\" type=\"number\" min=\"1\" max=\"3660\" value=\"31\" required></div><div><label for=\"member-valid\">领取期限 / 天（1–3660）</label><input id=\"member-valid\" name=\"validDays\" type=\"number\" min=\"1\" max=\"3660\" value=\"365\" required></div><div><label for=\"member-label\">批次备注</label><input id=\"member-label\" name=\"label\" maxlength=\"80\" placeholder=\"例如：新用户活动\"></div></div></form>\n<div class=\"table-wrap bordered\"><table><thead><tr><th>批次</th><th>产品 / 天数</th><th>总数 / 已兑 / 作废</th><th>领取截止</th><th>操作</th></tr></thead><tbody id=\"member-batches\"></tbody></table></div>\n<section class=\"panel panel-pad\" id=\"member-delivery\" style=\"margin-top:20px\" hidden><div class=\"panel-heading\"><div><h2 id=\"member-delivery-title\">本批兑换码</h2><p>请妥善保管兑换码及领取链接，勿公开未发放的兑换码。</p></div><div class=\"inline-actions\"><button id=\"member-copy\" disabled>复制可用码列表</button><button id=\"member-txt\" disabled>导出可用码 TXT</button><button id=\"member-csv\">导出 CSV</button></div></div><label class=\"inline-actions\"><input id=\"member-code-numbered\" type=\"checkbox\" checked>包含序号（1、2、3…）</label><label for=\"member-code-list\">可用兑换码列表（每行一个）</label><textarea id=\"member-code-list\" rows=\"6\" readonly spellcheck=\"false\" placeholder=\"本批暂无可用兑换码\" style=\"font-family:monospace;white-space:pre;overflow-wrap:normal\"></textarea><p class=\"note\" id=\"member-code-count\"></p><div class=\"table-wrap\"><table><thead><tr><th>兑换码</th><th>状态</th><th>操作</th></tr></thead><tbody id=\"member-codes\"></tbody></table></div></section></div>\n<div data-member-panel=\"accounts\" hidden><form class=\"filters\" id=\"member-search\"><input name=\"query\" aria-label=\"搜索会员邮箱或昵称\" placeholder=\"搜索邮箱或昵称…\" maxlength=\"100\"><button type=\"submit\">搜索账号</button></form><div class=\"table-wrap bordered\"><table><thead><tr><th>昵称 / 邮箱</th><th>账号创建</th><th>会员权益 / 状态</th><th>兑换次数</th><th>操作</th></tr></thead><tbody id=\"member-accounts\"></tbody></table></div><p class=\"note\">最近 50 个匹配账号，可按邮箱或昵称搜索并管理会员、封禁状态。档案和原图保存在用户本机。</p></div>\n<div data-member-panel=\"gifts\" hidden><p class=\"note\">仅在爱发电私信确认发送者身份后批准关联，系统会重新核验订单与真实会员有效期。</p><div class=\"table-wrap bordered\"><table><thead><tr><th>账号</th><th>爱发电用户</th><th>订单 / 产品</th><th>状态</th><th>操作</th></tr></thead><tbody id=\"member-gifts\"></tbody></table></div></div>\n<div data-member-panel=\"reports\" hidden><p class=\"note\">仅展示已收到的举报，可查看副本后处理。移除副本不会删除用户已经保存到本机的文件；暂停漂流不影响其会员权益。</p><div class=\"table-wrap bordered\"><table><thead><tr><th>分享者 / 留言</th><th>举报原因</th><th>提交时间</th><th>状态</th><th>处理</th></tr></thead><tbody id=\"member-reports\"></tbody></table></div></div>\n<div data-member-panel=\"messages\" hidden>\n<form id=\"member-message-form\" class=\"panel panel-pad\" style=\"margin-bottom:20px\"><div class=\"panel-heading\"><div><h2>给客户端发送消息</h2><p>先预览并确认收件人数，再发送；不会发送邮件。</p></div><button type=\"submit\" class=\"primary\">预览消息</button></div>\n<div class=\"settings-grid\"><div><label for=\"member-message-kind\">提示方式</label><select id=\"member-message-kind\"><option value=\"toast\">Toast · 轻量提示，约 6 秒</option><option value=\"alert\">Alert · 顶部横幅，手动关闭</option></select></div><div><label for=\"member-message-audience\">收件范围</label><select id=\"member-message-audience\"><option value=\"single\">单个账号</option><option value=\"all\">全部正常账号</option><option value=\"plus\">当前 Plus 账号</option><option value=\"pro\">当前 Pro 账号</option><option value=\"free\">无有效订阅（含试用）</option></select></div><div id=\"member-message-target-wrap\"><label for=\"member-message-target\">收件账号邮箱或 ID</label><input id=\"member-message-target\" maxlength=\"254\" required></div><div><label for=\"member-message-valid\">有效天数（1–30）</label><input id=\"member-message-valid\" type=\"number\" min=\"1\" max=\"30\" value=\"7\" required></div></div>\n<label for=\"member-message-title\" style=\"margin-top:16px\">标题</label><input id=\"member-message-title\" maxlength=\"60\" required><label for=\"member-message-body\" style=\"margin-top:16px\">消息正文</label><textarea id=\"member-message-body\" maxlength=\"140\" rows=\"4\" required></textarea><p class=\"note\" id=\"member-message-hint\">Toast 正文最多 140 字，轻量显示后自动消失。</p><p class=\"note\">需要支持客户端消息的新版应用。登录用户在应用启动或切回前台时接收，前台联网期间约每分钟同步；离线用户可在有效期内上线接收。收件人数按账号计算，封禁账号不接收，新注册账号不补发旧群发消息。</p></form>\n<div class=\"table-wrap bordered\"><table><thead><tr><th>标题 / 样式</th><th>收件范围</th><th>状态 / 已展示</th><th>有效期</th><th>操作</th></tr></thead><tbody id=\"member-message-list\"></tbody></table></div></div>\n</section>\n<dialog id=\"member-review-dialog\"><form id=\"member-review-form\" class=\"panel-pad\"><h2>核对爱发电关联</h2><p id=\"member-review-summary\" class=\"note\"></p><label for=\"member-review-code\">从该爱发电用户私信收到的关联码</label><input id=\"member-review-code\" required autocomplete=\"off\"><label class=\"inline-actions\" style=\"margin:18px 0\"><input id=\"member-review-confirm\" type=\"checkbox\" required>我已核对私信发送者和订单身份</label><div class=\"inline-actions\"><button type=\"button\" id=\"member-review-cancel\">取消</button><button type=\"submit\" class=\"primary\">重新核验并关联</button></div></form></dialog>\n\n<dialog id=\"member-report-preview\"><div class=\"panel-pad\"><div class=\"panel-heading\"><h2>被举报的底片副本</h2><button id=\"member-report-close\">关闭</button></div><img id=\"member-report-image\" alt=\"被举报的底片副本\" style=\"display:block;max-width:75vw;max-height:65vh;object-fit:contain\"></div></dialog>\n\n<dialog id=\"member-account-dialog\" aria-labelledby=\"member-account-title\" style=\"width:min(840px,94vw)\">\n<div class=\"panel-pad\"><div class=\"panel-heading\"><div><h2 id=\"member-account-title\">账号管理</h2><p class=\"muted\" id=\"member-account-email\"></p></div><button type=\"button\" id=\"member-account-close\">关闭</button></div>\n<p class=\"note\" id=\"member-account-state\"></p><p class=\"note\" id=\"member-account-ban-reason\"></p>\n<div class=\"table-wrap bordered\" style=\"margin:16px 0\"><table><thead><tr><th>会员档位</th><th>期限</th><th>来源 / 状态</th><th>操作</th></tr></thead><tbody id=\"member-account-grants\"></tbody></table></div>\n<form id=\"member-account-form\"><h3 style=\"margin-bottom:14px\">直接授予会员</h3><div class=\"settings-grid\"><div><label for=\"member-grant-tier\">会员档位</label><select id=\"member-grant-tier\"><option value=\"plus\">Plus</option><option value=\"pro\">Pro</option></select></div><div id=\"member-grant-duration\"><label for=\"member-grant-days\">有效天数（1–3660）</label><input id=\"member-grant-days\" type=\"number\" min=\"1\" max=\"3660\" value=\"31\" required></div></div><label class=\"inline-actions\" style=\"margin:16px 0\"><input id=\"member-grant-permanent\" type=\"checkbox\">永久会员（可随时取消）</label>\n<label for=\"member-account-reason\">操作原因（授予、取消、封禁或解封均需填写）</label><textarea id=\"member-account-reason\" maxlength=\"500\" rows=\"2\" required placeholder=\"例如：活动赠送、测试账号或违规处理\"></textarea>\n<p class=\"note\">授予从现在起计时，保存会替换本账号同档位的手动授予；购买、兑换和其他档位独立保留。权益列表可逐条调整、取消各来源权益，包括购买、兑换、试用及创作券授权；购买期限的人工调整持续覆盖自动同步，恢复原值后才重新跟随平台。</p>\n<div class=\"inline-actions\" style=\"margin:16px 0\"><button type=\"submit\" class=\"primary\" id=\"member-grant-submit\">确认授予</button><button type=\"button\" class=\"danger\" id=\"member-account-status\">封禁账号</button><button type=\"button\" id=\"member-account-message\">给此账号发消息</button></div></form>\n<p class=\"note\">会员变更在客户端下次联网刷新权益后生效。封禁会立即注销服务端会话、阻止登录及在线服务；已签发的离线授权最多保留 7 天。解封后用户需重新登录。</p>\n<h3 style=\"margin-top:20px\">最近管理记录</h3><div id=\"member-account-history\" class=\"note\"></div></div></dialog>\n\n<dialog id=\"member-access-dialog\" aria-labelledby=\"member-access-title\"><form id=\"member-access-form\" class=\"panel-pad\"><div class=\"panel-heading\"><h2 id=\"member-access-title\">修改权益期限</h2><button type=\"button\" id=\"member-access-close\">关闭</button></div><p id=\"member-access-summary\" class=\"note\"></p><label for=\"member-access-expiry\">新的到期时间（本地时区）</label><input type=\"datetime-local\" id=\"member-access-expiry\" required><label class=\"inline-actions\" style=\"margin:16px 0\"><input type=\"checkbox\" id=\"member-access-permanent\">永久有效</label><label for=\"member-access-reason\">操作原因</label><textarea id=\"member-access-reason\" required maxlength=\"500\" rows=\"2\"></textarea><p class=\"note\">人工修改优先于平台同步；可延长、缩短或设为永久。取消与恢复原始期限可在权益列表逐条操作。</p><button class=\"primary\" type=\"submit\">保存期限</button></form></dialog>\n<dialog id=\"member-message-preview-dialog\" aria-labelledby=\"member-message-preview-title\"><div class=\"panel-pad\"><div class=\"panel-heading\"><h2 id=\"member-message-preview-title\">客户端消息预览</h2><button id=\"member-message-preview-close\">关闭</button></div><p class=\"note\" id=\"member-message-preview-meta\"></p><div id=\"member-message-preview-card\" class=\"panel panel-pad\" style=\"margin:20px 0;border-left:3px solid #d9a390\"><h3 id=\"member-message-preview-heading\"></h3><p id=\"member-message-preview-body\" style=\"white-space:pre-wrap;margin-top:8px;overflow-wrap:anywhere\"></p></div><p class=\"note\" id=\"member-message-preview-progress\"></p><button id=\"member-message-send\" class=\"primary\">确认发送</button></div></dialog>\n\n<section id=\"view-automation\" data-panel=\"automation\" hidden><div class=\"page-heading\"><div><h1>自动化</h1><p>版本通知、退信检查与投递管理。</p></div></div><form id=\"automation-form\"><div class=\"settings-grid\"><section class=\"panel panel-pad\"><div class=\"panel-heading\"><h2>版本通知</h2><span id=\"release-health\"></span></div><div class=\"setting-row\"><div><label for=\"auto-enabled\">新版本自动通知</label><small>按下载过的平台发送正式版本更新。</small></div><input class=\"switch\" type=\"checkbox\" name=\"enabled\" id=\"auto-enabled\"></div><div class=\"setting-row\"><div><label for=\"auto-prerelease\">包含预览版</label><small>开启后，也发送新的 Prerelease 版本。</small></div><input class=\"switch\" type=\"checkbox\" name=\"includePrerelease\" id=\"auto-prerelease\"></div><div class=\"settings-meta\" id=\"release-meta\"></div><div class=\"settings-actions\"><button type=\"button\" id=\"check-releases\">检查新版本</button><small>发布事件触发，5 分钟轮询兜底</small></div></section><section class=\"panel panel-pad\"><div class=\"panel-heading\"><h2>退信检查</h2><span id=\"imap-health\"></span></div><div class=\"setting-row\"><div><label for=\"auto-imap\">QQ IMAP 自动检查</label><small>只处理与本站投递记录匹配的退信报告。</small></div><input class=\"switch\" type=\"checkbox\" name=\"imapEnabled\" id=\"auto-imap\"></div><div class=\"settings-meta\" id=\"imap-meta\"></div><div class=\"settings-actions\"><button type=\"button\" id=\"check-imap\">检查连接与退信</button><small>约每 5 分钟检查一次</small></div><p class=\"note\">不改变邮箱已读状态，不删除邮件。不支持的退信格式请到站长邮箱核实。</p></section></div><div class=\"settings-footer\"><span class=\"save-state\" id=\"settings-save-state\">设置已保存</span><button type=\"submit\" class=\"primary\" id=\"save-settings\">保存设置</button></div></form><form id=\"workflow-form\" class=\"panel panel-pad\" style=\"margin-bottom:23px\"><div class=\"panel-heading\"><h2>运营自动化</h2><span id=\"workflow-health\"></span></div><div class=\"settings-grid\"><section><div class=\"setting-row\"><div><label for=\"weekly-enabled\">每周运营简报</label><small>汇总访问、下载平台、订阅变动和待处理反馈，仅寄给站长。</small></div><input class=\"switch\" type=\"checkbox\" id=\"weekly-enabled\" name=\"weeklyEnabled\"></div><div class=\"inline-actions\"><label>每周<select name=\"weeklyDay\" aria-label=\"简报星期\"><option value=\"1\">星期一</option><option value=\"2\">星期二</option><option value=\"3\">星期三</option><option value=\"4\">星期四</option><option value=\"5\">星期五</option><option value=\"6\">星期六</option><option value=\"0\">星期日</option></select></label><label>北京时间<input type=\"time\" name=\"weeklyTime\" aria-label=\"简报时间\" required></label></div><div class=\"settings-meta\" id=\"weekly-meta\"></div><div class=\"inline-actions\"><button type=\"button\" id=\"preview-report\">预览简报</button><button type=\"button\" id=\"test-report\">发送简报测试</button></div></section><section><div class=\"setting-row\"><div><label for=\"followup-enabled\">下载后反馈回访</label><small>仅向仍在订阅、未退信抑制且未在网站提交反馈的邮箱发送。</small></div><input class=\"switch\" type=\"checkbox\" id=\"followup-enabled\" name=\"followupEnabled\"></div><label for=\"followup-days\">首次下载后等待天数</label><input style=\"max-width:130px\" type=\"number\" min=\"1\" max=\"30\" id=\"followup-days\" name=\"followupDays\" required><p class=\"note\">从启用后的首次下载开始计时，每个邮箱最多回访一次。暂停时到期的待发回访会跳过。</p><div class=\"settings-meta\" id=\"followup-meta\"></div></section></div><div style=\"margin-top:22px;padding-top:18px;border-top:1px solid var(--line)\"><label for=\"release-mode\">新版本邮件处理方式</label><select name=\"releaseMode\" id=\"release-mode\" style=\"max-width:340px\"><option value=\"draft\">先生成草稿，审核后发送</option><option value=\"auto\">自动发送版本通知</option></select><p class=\"note\">草稿按平台整理公开版本说明，可编辑、预览、发测试邮件，再确认发送。沿用上方的新版本开关和预览版设置。</p><div class=\"inline-actions\"><button type=\"button\" data-release-draft=\"mac\">生成 macOS 草稿</button><button type=\"button\" data-release-draft=\"windows\">生成 Windows 草稿</button></div></div><div class=\"settings-footer\"><span class=\"save-state\" id=\"workflow-save-state\">正在加载设置…</span><button type=\"submit\" class=\"primary\" id=\"save-workflows\">保存运营设置</button></div><details><summary>最近简报记录</summary><div class=\"settings-meta\" id=\"report-history\"></div></details></form><div class=\"panel panel-pad\" style=\"margin-bottom:23px\"><div class=\"panel-heading\" style=\"margin-bottom:10px\"><h2>投递规则</h2><span id=\"smtp-health\"></span></div><p class=\"note\" style=\"margin:0\">临时失败最多尝试 4 次，间隔 5 分钟、30 分钟、2 小时。提交后状态不明的邮件会标为“待核实”，避免重复投递。首次启用不补发历史版本；暂停期间发布的版本不在恢复后补发。</p></div><div class=\"panel-heading\"><h2>停止投递的地址</h2><small>解除抑制不会改变订阅状态或补发旧邮件</small></div><div class=\"table-wrap bordered\"><table><thead><tr><th>邮箱</th><th>原因</th><th>来源</th><th>时间</th><th></th></tr></thead><tbody id=\"suppression-rows\"></tbody></table></div><details class=\"details-section\"><summary>退信历史</summary><div class=\"table-wrap bordered\"><table><thead><tr><th>时间</th><th>邮箱 / 邮件</th><th>类型</th><th>原因</th></tr></thead><tbody id=\"bounce-rows\"></tbody></table></div></details></section>\n</div></main></div>\n<dialog id=\"send-review\" aria-labelledby=\"review-title\"><div class=\"dialog-head\"><h2 id=\"review-title\">检查并发送</h2><button class=\"quiet small\" data-close-review aria-label=\"关闭发送检查\"><svg class=\"icon\"><use href=\"#i-close\"/></svg></button></div><div class=\"dialog-body\"><p>请核对当前邮件与收件名单。</p><div class=\"review-grid\"><div><span>邮件标题</span><strong id=\"review-subject\"></strong></div><div><span>收件平台</span><strong id=\"review-audience\"></strong></div><div><span>有效收件人</span><strong id=\"review-count\"></strong></div><div><span>发送时间</span><strong id=\"review-time\"></strong></div></div><div class=\"review-test\" id=\"review-test\"></div><p class=\"dialog-error\" id=\"review-error\" role=\"status\"></p></div><div class=\"dialog-footer\"><button class=\"quiet\" data-close-review>返回编辑</button><button class=\"primary\" data-mail-action id=\"review-action\">发送测试邮件</button></div></dialog>\n<dialog id=\"confirm-dialog\" aria-labelledby=\"confirm-title\"><div class=\"dialog-head\"><h2 id=\"confirm-title\"></h2></div><div class=\"dialog-body\"><p id=\"confirm-text\" style=\"white-space:pre-wrap\"></p></div><div class=\"dialog-footer\"><button class=\"quiet\" id=\"confirm-cancel\">取消</button><button class=\"primary\" id=\"confirm-accept\">确认</button></div></dialog>\n<div id=\"toast\" class=\"toast\" role=\"status\" hidden></div>\n<dialog id=\"mail-image-dialog\" aria-labelledby=\"mail-image-title\"><div class=\"dialog-head\"><h2 id=\"mail-image-title\">插入正文图片</h2><button type=\"button\" id=\"close-mail-image\" aria-label=\"关闭插入图片\">关闭</button></div><form id=\"mail-image-form\" novalidate><div class=\"dialog-body form-fields\"><div><label for=\"mail-image-url\">图片地址</label><input id=\"mail-image-url\" type=\"url\" maxlength=\"2048\" placeholder=\"https://…\" autocomplete=\"off\"><p class=\"field-help\">使用可公开访问的 HTTPS 图片链接，例如 GitHub Release 中的展示图。</p></div><div><label for=\"mail-image-alt\">图片说明</label><input id=\"mail-image-alt\" maxlength=\"160\" placeholder=\"例如：MuseFilm 4.0 光页画册\"><p class=\"field-help\">说明会显示在图片下方；图片被邮箱拦截时仍可阅读。</p></div><p id=\"mail-image-error\" class=\"field-error\" role=\"status\"></p></div><div class=\"dialog-footer\"><button type=\"submit\" class=\"primary\">插入到正文</button></div></form></dialog>\n<dialog id=\"report-preview-dialog\" aria-labelledby=\"report-preview-title\"><div class=\"dialog-head\"><h2 id=\"report-preview-title\">每周运营简报预览</h2><button type=\"button\" id=\"close-report-preview\" aria-label=\"关闭简报预览\">关闭</button></div><div class=\"dialog-body\"><p class=\"note\">此预览使用最近 7 天数据，正式简报按设定时间统计完整一期。</p><iframe title=\"简报邮件预览\" id=\"report-preview-frame\" sandbox=\"\" style=\"width:100%;height:450px;border:0;background:#151413\"></iframe></div></dialog><script>\n'use strict';\nconst $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];\nconst names={overview:'概览',mail:'邮件',subscribers:'订阅者',activity:'活动记录',automation:'自动化',membership:'会员与充值'};\nconst audiences={all:'全部有效订阅者',windows:'Windows 用户',mac:'macOS 用户'};\nconst deliveryNames={draft:'草稿',scheduled:'预约中',queued:'排队中',pending:'待发送',sending:'发送中',retry_wait:'等待重试',sent:'已提交',failed:'失败',partial_failure:'需要处理',uncertain:'待核实',bounced:'已退信',skipped:'已跳过',cancelled:'已取消',suppressed:'已停止',not_configured:'未配置'};\nconst subscriptionNames={subscribed:'已订阅',pending:'待确认',contact:'仅留邮箱',unsubscribed:'已退订'};\nconst feedbackNames={new:'待处理',reviewing:'处理中',resolved:'已处理',archived:'已归档'};\nconst state={view:'overview',viewToken:0,loaders:0,overview:null,mailConfig:null,campaigns:[],mailFilter:'all',page:1,subscriberTotal:0,activity:'downloads',downloads:[],feedback:[],settings:null,settingsSig:'',workflowSig:'',mailBusy:false,editor:{id:'',saved:null,sig:'',html:''},detail:null,detailToken:0,review:null,challengeId:'',confirmResolve:null};\nlet toastTimer,progressTimer,loginTimer;\nfunction esc(value){return String(value??'').replace(/[&<>\"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[char]))}\nfunction number(value){return Number(value || 0).toLocaleString('zh-CN')}\nfunction date(value){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚无记录'}\nfunction shortDate(value){return value?new Date(value).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}):'—'}\nfunction badge(status,kind='delivery'){\n  const labels=kind==='subscription'?subscriptionNames:kind==='feedback'?feedbackNames:deliveryNames;\n  const good=kind==='subscription'?status==='subscribed':kind==='feedback'?status==='resolved':status==='sent';\n  const tone=good?'good':['failed','partial_failure','uncertain','bounced'].includes(status)?'bad':['pending','queued','sending','retry_wait','new','reviewing'].includes(status)?'wait':status==='scheduled'?'info':'';\n  return `<span class=\"badge ${tone}\">${esc(labels[status] || status || '—')}</span>`;\n}\nfunction emptyRow(columns,title,description=''){return `<tr><td colspan=\"${columns}\" class=\"empty\"><strong>${esc(title)}</strong>${esc(description)}</td></tr>`}\nfunction toast(message,error=false){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.toggle('error',error);$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,error?8000:4500)}\nfunction pageError(error){$('#page-error-text').textContent=error.message || String(error);$('#page-error').hidden=false}\nfunction showLogin(message=''){clearMemberData();clearTimeout(progressTimer);$('#dashboard').hidden=true;$('#login').hidden=false;$('#login-message').textContent=message}\nasync function api(path,{method='GET',body,raw=false}={}){\n  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),40000);state.loaders++;$('#loading-line').hidden=false;\n  try {\n    const response=await fetch(path,{method,cache:'no-store',credentials:'same-origin',signal:controller.signal,headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});\n    if(response.status===401 && !path.includes('/login')){showLogin('登录已过期，请重新登录。当前页面的邮件内容已保留。');throw Object.assign(new Error('请重新登录后继续。'),{status:401})}\n    if(raw && response.ok)return response;\n    let data;try{data=await response.json()}catch{throw new Error('服务器返回异常，请稍后重试。')}\n    if(!response.ok || !data.ok){const errors={internal_error:'服务暂时不可用，请稍后重试。',origin_not_allowed:'请求来源无效，请重新打开后台。',not_found:'该记录不存在，请刷新列表。'};throw Object.assign(new Error(errors[data.error] || data.error || '操作失败，请重试。'),{status:response.status})}\n    return data;\n  }catch(error){if(error.name==='AbortError')throw new Error('请求超时，请刷新状态后重试。');if(error instanceof TypeError)throw new Error('网络连接失败，请检查网络后重试。');throw error}\n  finally{clearTimeout(timeout);state.loaders--;$('#loading-line').hidden=state.loaders===0}\n}\nconst post=(path,body={})=>api(path,{method:'POST',body});\nfunction confirmAction(title,text,label='确认'){\n  if($('#confirm-dialog').open)return Promise.resolve(false);\n  $('#confirm-title').textContent=title;$('#confirm-text').textContent=text;$('#confirm-accept').textContent=label;$('#confirm-dialog').showModal();\n  return new Promise(resolve=>state.confirmResolve=resolve);\n}\nfunction resolveConfirm(answer){const resolve=state.confirmResolve;state.confirmResolve=null;$('#confirm-dialog').close();resolve?.(answer)}\n$('#confirm-cancel').onclick=()=>resolveConfirm(false);$('#confirm-accept').onclick=()=>resolveConfirm(true);$('#confirm-dialog').addEventListener('cancel',event=>{event.preventDefault();resolveConfirm(false)});\nfunction updateSync(){const now=new Date();$('#last-sync').textContent='更新于 '+now.toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'})}\nasync function navigate(view,{load=true}={}){\n  if(!names[view])view='overview';if(state.view==='membership'&&view!=='membership')clearMemberData();state.view=view;state.viewToken++;clearTimeout(progressTimer);$('#page-error').hidden=true;\n  $$('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==view);$$('.nav [data-view]').forEach(button=>{if(button.dataset.view===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')});\n  $('#breadcrumb').textContent=names[view];document.title=names[view]+' · MuseFilm 后台';history.replaceState(null,'','#'+view);\n  if(load)await loadCurrent();\n}\nasync function loadCurrent(){const token=state.viewToken;$('#page-error').hidden=true;try{\n  if(state.view==='overview')await loadOverview(token);\n  else if(state.view==='mail'){await loadCampaigns(token);if(!$('#mail-detail-view').hidden)await loadDelivery()}\n  else if(state.view==='subscribers')await loadSubscribers(token);\n  else if(state.view==='activity')await loadActivity(token);\n  else if(state.view==='membership')await loadMembership();\n  else if(state.view==='automation')await loadAutomation(token);\n  if(token===state.viewToken)updateSync();\n}catch(error){if(error.status!==401 && token===state.viewToken)pageError(error)}}\nfunction campaignRows(campaigns){return campaigns.map(c=>`<tr><td class=\"subject-cell\"><strong>${esc(c.subject)}</strong><small>${c.kind==='followup'?'下载后回访':c.kind==='release'?'版本更新':'手动邮件'}</small></td><td>${c.kind==='followup'?'下载后回访（单人）':esc(audiences[c.audience] || audiences.all)}</td><td>${badge(c.status)}</td><td>${esc(date(c.scheduled_at || c.updated_at))}</td><td><button class=\"small quiet\" data-open-campaign=\"${esc(c.id)}\">${c.status==='draft'?'编辑':'查看'}</button></td></tr>`).join('')}\nasync function loadOverview(token){const data=await api('/api/admin/overview');state.overview=data;state.audienceCounts=data.audiences || {all:data.totals.subscribers};$('#preview-banner').hidden=!data.preview;if(token!==state.viewToken || state.view!=='overview')return;\n  $('#preview-banner').hidden=!data.preview;for(const key of ['visits','downloads','subscribers','queued'])$('#metric-'+key).textContent=number(data.totals[key]);\n  $('#nav-mail-count').textContent=number(data.totals.queued);$('#nav-mail-count').hidden=!data.totals.queued;$('#nav-feedback-count').textContent=number(data.totals.feedback);$('#nav-feedback-count').hidden=!data.totals.feedback;\n  const s=data.settings || {},tickGood=s.last_tick_at && Date.now()-Date.parse(s.last_tick_at)<10*60000;\n  const health=[['邮件服务',data.mailReady?'已配置':'未配置',data.mailReady],['版本自动通知',s.scan_error?'检查异常':s.enabled?'已启用':'已暂停',Boolean(s.enabled && !s.scan_error)],['退信检查',!s.imap_enabled?'已暂停':s.imap_error?'检查异常':s.imap_last_at?'连接正常':'等待检查',Boolean(s.imap_enabled && s.imap_last_at && !s.imap_error)],['定时任务',tickGood?'运行正常':s.last_tick_at?'运行延迟':'等待首次运行',tickGood]];\n  $('#health-list').innerHTML=health.map(([title,value,good])=>`<div class=\"health-row\"><span>${esc(title)}</span><span class=\"health-value ${good?'':'warning'}\"><i class=\"dot ${good?'green':''}\"></i>${esc(value)}</span></div>`).join('');\n  $('#attention-note').hidden=!data.totals.attention;$('#attention-note').textContent=number(data.totals.attention)+' 条投递需要处理，查看邮件 →';\n  $('#recent-campaigns').innerHTML=data.campaigns.length?campaignRows(data.campaigns):emptyRow(5,'还没有邮件','点击“新建邮件”开始写第一封。');\n  renderTraffic(data.daily);renderEditorStatus();\n}\nfunction renderTraffic(daily){const viewMap=new Map((daily.views || []).map(row=>[row.day,Number(row.count)])),downloadMap=new Map((daily.downloads || []).map(row=>[row.day,Number(row.count)]));\n  const days=Array.from({length:7},(_,index)=>new Date(Date.now()+8*3600000-(6-index)*86400000).toISOString().slice(0,10));const max=Math.max(1,...days.map(day=>viewMap.get(day)||0),...days.map(day=>downloadMap.get(day)||0));\n  $('#traffic-chart').innerHTML=days.map(day=>{const views=viewMap.get(day)||0,downloads=downloadMap.get(day)||0;return `<div class=\"chart-day\" title=\"${esc(day)}：${views} 次访问，${downloads} 次下载点击\"><div class=\"chart-bars\"><span class=\"chart-bar\" style=\"--height:${Math.round(views/max*100)}%\"></span><span class=\"chart-bar secondary\" style=\"--height:${Math.round(downloads/max*100)}%\"></span></div><small>${esc(day.slice(5).replace('-','/'))}</small></div>`}).join('');\n  const views=days.reduce((sum,day)=>sum+(viewMap.get(day)||0),0),downloads=days.reduce((sum,day)=>sum+(downloadMap.get(day)||0),0);const summary=`近 7 日共 ${number(views)} 次访问，${number(downloads)} 次下载点击。`;$('#traffic-summary').textContent=summary;$('#traffic-chart').setAttribute('aria-label',summary+days.map(day=>`${day} 访问 ${viewMap.get(day)||0}，下载 ${downloadMap.get(day)||0}`).join('；'));\n}\nasync function loadCampaigns(token=state.viewToken){const data=await api('/api/admin/campaigns');state.campaigns=data.campaigns;if(state.view==='mail' && token===state.viewToken)renderCampaigns()}\nfunction renderCampaigns(){const query=$('#mail-search').value.trim().toLowerCase();const campaigns=state.campaigns.filter(c=>c.subject.toLowerCase().includes(query) && (state.mailFilter==='all' || state.mailFilter==='active' && ['queued','sending','retry_wait'].includes(c.status) || state.mailFilter==='done' && ['sent','partial_failure','cancelled'].includes(c.status) || c.status===state.mailFilter));$('#campaign-rows').innerHTML=campaigns.length?campaignRows(campaigns):emptyRow(5,'没有符合条件的邮件',state.campaigns.length?'试试其他筛选条件。':'点击“新建邮件”创建草稿。')}\nfunction subscriberQuery(){const form=$('#subscriber-filters');return new URLSearchParams({q:form.elements.q.value,status:form.elements.status.value,platform:form.elements.platform.value,page:String(state.page)})}\nasync function loadSubscribers(token=state.viewToken){const query=subscriberQuery().toString(),data=await api('/api/admin/subscribers?'+query);if(token!==state.viewToken || state.view!=='subscribers' || query!==subscriberQuery().toString())return;state.subscriberTotal=data.total;\n  $('#subscriber-summary').textContent=`共 ${number(data.stats?.total)} 个邮箱，${number(data.stats?.eligible)} 位有效订阅者。`;\n  $('#subscriber-rows').innerHTML=data.subscribers.length?data.subscribers.map(row=>`<tr><td>${esc(row.email)}<small>加入于 ${esc(shortDate(row.created_at))}</small></td><td>${badge(row.status,'subscription')}${row.suppression_reason?'<small style=\"color:var(--red)\">退信抑制中</small>':''}</td><td>${esc((row.platforms || row.platform || '').split(',').filter(Boolean).map(p=>p==='mac'?'macOS':p==='windows'?'Windows':p).join(' / ') || '—')}</td><td>${badge(row.thank_you_status)}</td><td>${esc(row.last_download_at?date(row.last_download_at):'—')}</td><td>${row.status==='unsubscribed'?'<span class=\"muted\">—</span>':`<button class=\"small quiet\" data-stop-subscriber=\"${esc(row.id)}\" data-email=\"${esc(row.email)}\">停止发信</button>`}</td></tr>`).join(''):emptyRow(6,'没有符合条件的邮箱','可以清除筛选或等待访客自愿留下邮箱。');\n  $('#subscriber-page').textContent=`${number(data.total)} 条结果 · 第 ${state.page} / ${Math.max(1,Math.ceil(data.total/50))} 页`;$('#previous-page').disabled=state.page<=1;$('#next-page').disabled=state.page*50>=data.total;\n}\nasync function loadActivity(token=state.viewToken){const mode=state.activity,data=await api('/api/admin/'+(mode==='feedback'?'feedback':'downloads'));if(token!==state.viewToken || mode!==state.activity || state.view!=='activity')return;if(mode==='feedback')state.feedback=data.feedback;else state.downloads=data.downloads;renderActivity()}\nfunction renderActivity(){const query=$('#activity-search').value.trim().toLowerCase();$('#downloads-panel').hidden=state.activity!=='downloads';$('#feedback-panel').hidden=state.activity!=='feedback';\n  if(state.activity==='downloads'){const rows=state.downloads.filter(row=>[row.asset_name,row.contact_email,row.ip_address,row.country,row.region,row.city,row.operating_system].join(' ').toLowerCase().includes(query));$('#download-rows').innerHTML=rows.length?rows.map(row=>`<tr><td>${esc(date(row.created_at))}</td><td class=\"subject-cell\"><strong>${esc(row.asset_name)}</strong><small>${esc(row.contact_email || '未留下邮箱')}</small></td><td>${esc(row.operating_system || '—')}<small>${esc(row.browser || '')}</small></td><td>${esc(row.ip_address || '—')}<small>${esc([row.country,row.region,row.city].filter(Boolean).join(' / ') || '未知地区')}</small></td><td>${badge(row.email_status)}</td></tr>`).join(''):emptyRow(5,'没有符合条件的下载记录');return}\n  const rows=state.feedback.filter(row=>[row.message,row.contact_email,row.type].join(' ').toLowerCase().includes(query));$('#feedback-list').innerHTML=rows.length?rows.map(row=>`<article class=\"feedback-card\"><div class=\"feedback-top\"><div class=\"feedback-meta\"><span class=\"badge\">${esc({bug:'问题反馈',suggestion:'功能建议',other:'其他'}[row.type] || '反馈')}</span><span>${esc(date(row.created_at))}</span></div>${badge(row.status,'feedback')}</div><p class=\"feedback-body\">${esc(row.message)}</p><div class=\"feedback-bottom\"><span>${esc(row.contact_email || '未留下联系邮箱')} · ${esc(row.platform || '—')}</span><select aria-label=\"处理 ${esc(row.contact_email || '匿名用户')} 的反馈\" data-feedback-status=\"${esc(row.id)}\">${Object.entries(feedbackNames).map(([value,label])=>`<option value=\"${value}\" ${value===row.status?'selected':''}>${label}</option>`).join('')}</select></div></article>`).join(''):'<div class=\"empty\"><strong>还没有符合条件的反馈</strong>网站提交的建议和问题会显示在这里。</div>';\n}\nfunction settingsValues(){const form=$('#automation-form');return {enabled:form.elements.enabled.checked,includePrerelease:form.elements.includePrerelease.checked,imapEnabled:form.elements.imapEnabled.checked}}\nfunction settingsDirty(){return state.settingsSig && JSON.stringify(settingsValues())!==state.settingsSig}\nfunction renderSettingsSave(){const dirty=settingsDirty();$('#settings-save-state').textContent=dirty?'有未保存的更改':'设置已保存';$('#settings-save-state').classList.toggle('dirty',Boolean(dirty))}\nasync function loadAutomation(token=state.viewToken,{reset=false}={}){const [data,bounces,config,workflows]=await Promise.all([api('/api/admin/automation'),api('/api/admin/bounces'),getMailConfig(),api('/api/admin/workflows')]);if(token!==state.viewToken || state.view!=='automation')return;renderWorkflows(workflows);const preserve=settingsDirty() && !reset;state.settings=data.settings;const s=data.settings;\n  if(!preserve){$$('#automation-form input,#save-settings').forEach(control=>control.disabled=false);const values={enabled:Boolean(s.enabled),includePrerelease:Boolean(s.include_prerelease),imapEnabled:Boolean(s.imap_enabled)};for(const [key,value] of Object.entries(values))$('#automation-form').elements[key].checked=value;state.settingsSig=JSON.stringify(values)}\n  state.audienceCounts={all:state.overview?.totals.subscribers || data.groups.reduce((sum,g)=>sum+Number(g.count),0),...Object.fromEntries(data.groups.map(g=>[g.platform,Number(g.count)]))};\n  $('#release-health').innerHTML=`<span class=\"badge ${s.scan_error?'bad':s.enabled?'good':''}\">${s.scan_error?'检查异常':s.enabled?'已启用':'已暂停'}</span>`;$('#release-meta').innerHTML=`<span>版本基线：${esc(date(s.baseline_at))}</span><span>最近检查：${esc(date(s.last_scan_at))}${s.scan_error?' · '+esc(s.scan_error):''}</span><span>服务器运行：${esc(date(s.last_tick_at))}</span>`;\n  $('#imap-health').innerHTML=`<span class=\"badge ${s.imap_error?'bad':s.imap_last_at?'good':''}\">${esc(!s.imap_enabled?'已暂停':s.imap_error?'检查异常':s.imap_last_at?'连接正常':'等待检查')}</span>`;\n  $('#imap-meta').innerHTML=`<span>最近检查：${esc(date(s.imap_last_at))}</span><span>已检查退信候选：${number(s.imap_checked)} 封${s.imap_error?' · '+esc(s.imap_error):''}</span>`;\n  $('#smtp-health').innerHTML=`<span class=\"badge ${config.ready?'good':'bad'}\">${config.ready?'发信服务已配置':'发信服务未配置'}</span>`;\n  $('#suppression-rows').innerHTML=bounces.suppressed.length?bounces.suppressed.map(row=>`<tr><td>${esc(row.email)}</td><td>${row.reason==='hard_bounce'?'终止投递的退信':esc(row.reason)}</td><td>${esc({qq_imap:'QQ IMAP',smtp_rcpt:'发送时拒收'}[row.source] || row.source)}</td><td>${esc(date(row.created_at))}</td><td><button class=\"small quiet\" data-restore-email=\"${esc(row.email)}\">解除抑制</button></td></tr>`).join(''):emptyRow(5,'没有停止投递的地址');\n  $('#bounce-rows').innerHTML=bounces.bounces.length?bounces.bounces.map(row=>`<tr><td>${esc(date(row.created_at))}</td><td class=\"subject-cell\"><strong>${esc(row.email)}</strong><small>${esc(row.subject || '')}</small></td><td>${row.kind==='hard'?'终止投递':'投递延迟'}</td><td class=\"break\">${esc(row.diagnostic)}</td></tr>`).join(''):emptyRow(4,'暂无匹配的退信报告');renderSettingsSave();\n}\nasync function getMailConfig(force=false){if(!state.mailConfig || force)state.mailConfig=await api('/api/admin/mail-config');return state.mailConfig}\nfunction editorFields(){const form=$('#mail-form');return {subject:form.elements.subject.value.trim(),body:form.elements.body.value.trim(),audience:form.elements.audience.value}}\nfunction editorSignature(fields=editorFields()){return JSON.stringify(fields)}\nfunction editorDirty(){return editorSignature()!==state.editor.sig}\nfunction testedCurrent(){return !editorDirty() && state.editor.saved?.test_status==='sent'}\nfunction renderEditorStatus(){\n  const fields=editorFields(),dirty=editorDirty(),tested=testedCurrent(),estimated=state.audienceCounts?.[fields.audience];\n  $('#body-count').textContent=number($('#mail-body').value.length)+' / 20,000';$('#save-state').textContent=state.mailBusy?'正在处理…':dirty?'有未保存的更改':state.editor.id?'已保存草稿':'新邮件';$('#save-state').classList.toggle('dirty',dirty);\n  $('#estimated-recipients').textContent=estimated===undefined?'发送前核对':number(estimated)+' 人';$('#audience-help').textContent=estimated===0?'该分组当前没有有效订阅者，可更换分组或查看订阅者。':'仅向已订阅且未停止投递的邮箱发送。';\n  $('#test-status').innerHTML=`<svg class=\"icon\" style=\"color:${tested?'var(--green)':'var(--orange)'}\"><use href=\"#i-${tested?'check':'clock'}\"/></svg><span>${tested?'当前内容的测试邮件已提交至站长邮箱。':dirty && state.editor.saved?.test_status==='sent'?'内容已修改，需要重新测试当前邮件。':'正式发送前，先给站长邮箱发一封测试信。'}</span>`;\n  if(!state.mailBusy){$('#test-mail').textContent=tested?'重新发送测试':'发送测试邮件';$('#prepare-send').innerHTML=`${$('#mail-form').elements.delivery.value==='later'?'检查并预约':'检查并发送'} <svg class=\"icon\"><use href=\"#i-arrow\"/></svg>`}\n  const later=$('#mail-form').elements.delivery.value==='later';$('#schedule-field').hidden=!later;\n}\nfunction validateEditor(){let valid=true;for(const [key,id,message] of [['subject','mail-subject','请填写邮件标题。'],['body','mail-body','请填写邮件正文。']]){const empty=!editorFields()[key];$('#'+key+'-error').textContent=empty?message:'';$('#'+id).setAttribute('aria-invalid',String(empty));if(empty)valid=false}if(!valid){(!editorFields().subject?$('#mail-subject'):$('#mail-body')).focus();throw new Error('请补全标出的邮件内容。')}return editorFields()}\nfunction scheduledTime(){const later=$('#mail-form').elements.delivery.value==='later',value=$('#schedule-time').value;$('#schedule-error').textContent='';if(!later)return null;const time=Date.parse(value);if(!Number.isFinite(time)||time<Date.now()+30000||time>Date.now()+365*86400000){$('#schedule-error').textContent='请选择 30 秒至一年之后的预约时间。';$('#schedule-time').focus();throw new Error('请检查预约时间。')}return new Date(time).toISOString()}\nfunction setEditorValues(campaign){const form=$('#mail-form');form.elements.subject.value=campaign.subject || '';form.elements.body.value=campaign.body || '';form.elements.audience.value=campaign.audience || 'all';form.elements.delivery.value='now';$('#schedule-time').value='';$('#editor-error').hidden=true;for(const key of ['subject','body','schedule'])$('#'+key+'-error').textContent='';for(const id of ['mail-subject','mail-body'])$('#'+id).removeAttribute('aria-invalid')}\nfunction showMailMode(mode){$('#mail-list-view').hidden=mode!=='list';$('#mail-editor-view').hidden=mode!=='editor';$('#mail-detail-view').hidden=mode!=='detail';if(mode!=='detail')clearTimeout(progressTimer)}\nasync function protectEditor(){if(!editorDirty() || !editorFields().subject && !editorFields().body)return true;return confirmAction('放弃未保存的更改？','当前邮件有尚未保存的内容。返回编辑可先保存草稿。','放弃更改')}\nasync function newMail(prefill={}){if(state.mailBusy)return toast('请等待当前邮件操作完成。');if(!await protectEditor())return;setEditorValues(prefill);state.editor={id:'',saved:null,sig:editorSignature({subject:'',body:'',audience:'all'}),html:''};$('#preview-frame').hidden=true;$('#preview-frame').srcdoc='';$('#preview-placeholder').hidden=false;await navigate('mail',{load:false});showMailMode('editor');renderEditorStatus();$('#mail-subject').focus()}\nasync function openCampaign(id){if(state.mailBusy)return toast('请等待当前邮件操作完成。');if(!await protectEditor())return;const token=++state.detailToken,viewToken=state.viewToken;try{const {campaign}=await api('/api/admin/campaigns/'+encodeURIComponent(id));if(token!==state.detailToken || viewToken!==state.viewToken)return;await navigate('mail',{load:false});if(campaign.status!=='draft'){state.detailId=id;state.detail=campaign;showMailMode('detail');await loadDelivery();return}setEditorValues(campaign);state.editor={id,saved:campaign,sig:editorSignature(),html:''};showMailMode('editor');renderEditorStatus();await refreshEditorPreview()}catch(error){if(error.status!==401)toast(error.message,true)}}\nfunction applyEditorPreview(data){if(data.campaign.id!==state.editor.id)return;state.editor.saved=data.campaign;state.editor.sig=editorSignature({subject:data.campaign.subject,body:data.campaign.body,audience:data.campaign.audience || 'all'});state.editor.html=data.html;state.editor.recipientCount=data.recipientCount;$('#preview-frame').srcdoc=data.html;$('#preview-frame').hidden=false;$('#preview-placeholder').hidden=true;renderEditorStatus()}\nasync function refreshEditorPreview(){const id=state.editor.id,data=await api('/api/admin/campaigns/'+encodeURIComponent(id)+'/preview');if(id!==state.editor.id)throw new Error('邮件已切换，请重新操作。');applyEditorPreview(data);return data}\nasync function saveDraft(){const fields=validateEditor(),id=state.editor.id;if(!id || editorDirty()){\n  const saved=await api('/api/admin/campaigns'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',body:{...fields,...(state.editor.saved?.updated_at?{expectedUpdatedAt:state.editor.saved.updated_at}:{})}});state.editor.id=saved.id;\n  const preview=await refreshEditorPreview();if(preview.campaign.status!=='draft')throw new Error('此邮件已开始发送，请返回列表查看投递记录。');return preview;\n}return refreshEditorPreview()}\nasync function mailAction(button,operation,{dialog=false}={}){if(state.mailBusy)return;state.mailBusy=true;const oldText=button.innerHTML;$$('[data-mail-action]').forEach(b=>b.disabled=true);$$('#mail-form input,#mail-form textarea,#mail-form select').forEach(input=>input.disabled=true);button.textContent='处理中…';$('#editor-error').hidden=true;$('#review-error').textContent='';renderEditorStatus();try{return await operation()}catch(error){if(error.status!==401){if(dialog && $('#send-review').open)$('#review-error').textContent=error.message;else{$('#editor-error').textContent=error.message;$('#editor-error').hidden=false}toast(error.message,true)}}finally{state.mailBusy=false;button.innerHTML=oldText;$$('[data-mail-action]').forEach(b=>b.disabled=false);$$('#mail-form input,#mail-form textarea,#mail-form select').forEach(input=>input.disabled=false);$('#mail-form [aria-invalid=\"true\"]')?.focus();renderEditorStatus();if($('#send-review').open)renderReview()}}\nasync function sendTest(){const config=await getMailConfig(true);if(!config.ready)throw new Error('发信服务尚未配置，请在“自动化”中查看服务状态。');const preview=await saveDraft();if(preview.campaign.status!=='draft')throw new Error('此邮件已开始发送，请查看投递记录。');await post('/api/admin/campaigns/'+encodeURIComponent(state.editor.id)+'/test');const data=await refreshEditorPreview();toast('测试邮件已提交至 '+(config.ownerEmail || '站长邮箱')+'。');return {data,config}}\nasync function prepareSend(){scheduledTime();const data=await saveDraft(),config=await getMailConfig(true);state.review={id:data.campaign.id,campaign:data.campaign,count:data.recipientCount,tested:data.campaign.test_status==='sent',scheduledAt:scheduledTime(),config};renderReview();$('#send-review').showModal()}\nfunction renderReview(){const r=state.review;if(!r)return;$('#review-subject').textContent=r.campaign.subject;$('#review-audience').textContent=audiences[r.campaign.audience] || audiences.all;$('#review-count').textContent=number(r.count)+' 人';$('#review-time').textContent=r.scheduledAt?date(r.scheduledAt):'立即加入发送队列';$('#review-test').classList.toggle('good',r.tested && Boolean(r.count) && r.config.ready);\n  let message,label;\n  if(!r.config.ready){message='发信服务尚未配置。可前往自动化查看状态，草稿已保存。';label='查看发信设置'}\n  else if(!r.count){message='该分组当前没有有效收件人。请更换分组，或在订阅者页查看订阅状态。';label='返回修改收件人'}\n  else if(!r.tested){message='先给站长邮箱发送当前内容的测试信，完成后即可正式发送。';label='发送测试邮件给我'}\n  else {message='当前内容的测试邮件已提交。请检查排版后确认发送。退订及停止投递的地址会被跳过。';label=r.scheduledAt?'确认预约给 '+number(r.count)+' 人':'确认发送给 '+number(r.count)+' 人'}\n  $('#review-test').textContent=message;if(!state.mailBusy)$('#review-action').textContent=label;\n}\nasync function reviewAction(){const r=state.review;if(!r)return;\n  if(!r.config.ready){$('#send-review').close();await navigate('automation');return}\n  if(!r.count){$('#send-review').close();$('#mail-audience').focus();return}\n  if(!r.tested){const {data,config}=await sendTest();state.review={...r,campaign:data.campaign,count:data.recipientCount,tested:data.campaign.test_status==='sent',config};return}\n  if(r.scheduledAt && Date.parse(r.scheduledAt)<Date.now()+30000)throw new Error('预约时间已临近或过期，请返回编辑重新选择时间。');\n  const result=await post('/api/admin/campaigns/'+encodeURIComponent(r.id)+'/start',{confirmRecipientCount:r.count,expectedUpdatedAt:r.campaign.updated_at,scheduledAt:r.scheduledAt});\n  $('#send-review').close();state.editor.saved={...r.campaign,status:result.status};state.editor.sig=editorSignature();state.detailId=r.id;state.detail=state.editor.saved;showMailMode('detail');toast(result.status==='scheduled'?'预约已保存，服务器将到时发送。':'已加入发送队列，关闭后台仍会继续。');await loadDelivery();await loadCampaigns();\n}\nasync function loadDelivery(){const id=state.detailId;if(!id)return;const token=state.detailToken;const [data,preview]=await Promise.all([api('/api/admin/campaigns/'+encodeURIComponent(id)+'/progress'),api('/api/admin/campaigns/'+encodeURIComponent(id)+'/preview')]);if(state.view!=='mail' || $('#mail-detail-view').hidden || id!==state.detailId || token!==state.detailToken)return;state.detail=data.campaign;const c=data.campaign,p=data.progress;\n  $('#detail-subject').textContent=c.subject;$('#detail-status').innerHTML=badge(c.status);$('#detail-meta').innerHTML=`<span>${c.kind==='followup'?'下载后回访（单人）':esc(audiences[c.audience] || audiences.all)}</span><span>${c.kind==='followup'?'下载后回访':c.kind==='release'?'版本更新':'手动邮件'}</span><span>${c.scheduled_at?'发送时间 '+esc(date(c.scheduled_at)):'创建于 '+esc(date(c.created_at))}</span>`;\n  $('#delivery-stats').innerHTML=[['sent','已提交'],['pending','待发送'],['sending','发送中'],['retry_wait','待重试'],['failed','失败'],['bounced','退信'],['uncertain','待核实'],['skipped','跳过']].map(([key,label])=>`<div>${label}<b>${number(p[key])}</b></div>`).join('');\n  $('#cancel-campaign').hidden=!['scheduled','queued'].includes(c.status);$('#cancel-campaign').textContent=c.status==='scheduled'?'取消预约':'取消发送';$('#retry-campaign').hidden=!data.recipients.some(row=>row.status==='failed' && row.retry_safe) && !(data.recipients.length===100 && p.failed);\n  $('#delivery-note').textContent=c.status==='scheduled'?'预约时的收件名单已保存，新增订阅者不会加入本次预约。开始投递前仍会检查退订状态。':p.uncertain?'存在待核实的投递：提交后未取得明确回复，系统不会自动重发这些邮件。':'“已提交”表示发送服务接受邮件，不代表已经送达收件箱。';\n  $('#delivery-rows').innerHTML=data.recipients.length?data.recipients.map(row=>`<tr><td>${esc(row.email)}</td><td>${badge(row.status)}</td><td>${number(row.attempts)} 次</td><td>${esc(row.next_attempt_at?date(row.next_attempt_at):row.sent_at?date(row.sent_at):'—')}</td><td>${esc(row.error_code || (row.last_stage==='accepted'?'发送服务已接受':'—'))}</td></tr>`).join(''):emptyRow(5,'没有投递名单');\n  $('#attempt-list').innerHTML=data.attempts.length?data.attempts.map(row=>`<div class=\"attempt-item\">${esc(date(row.created_at))} · ${esc(row.email)} · 第 ${number(row.attempt)} 次 · ${esc(deliveryNames[row.status] || row.status)}${row.error_code?' · '+esc(row.error_code):''}</div>`).join(''):'<p class=\"muted\">尚无投递尝试记录。</p>';$('#detail-frame').srcdoc=preview.html;\n  clearTimeout(progressTimer);if(p.pending || p.sending || p.retry_wait)progressTimer=setTimeout(()=>loadDelivery().catch(error=>{if(error.status!==401)pageError(error)}),c.status==='scheduled'?60000:15000);\n}\nasync function cancelCampaign(button){const id=state.detailId,label=state.detail?.status==='scheduled'?'取消预约':'取消发送';if(!await confirmAction(label+'？','尚未开始的投递将被取消。邮件内容和历史记录会保留，可复制为新邮件。',label))return;await buttonAction(button,async()=>{await post('/api/admin/campaigns/'+encodeURIComponent(id)+'/cancel');toast('尚未开始的投递已取消。');await loadDelivery();await loadCampaigns()})}\nasync function buttonAction(button,operation){if(button.disabled)return;const label=button.innerHTML;button.disabled=true;button.textContent='处理中…';try{await operation()}catch(error){if(error.status!==401)toast(error.message,true)}finally{button.disabled=false;button.innerHTML=label}}\n// Navigation uses the current view token; late responses cannot replace another page.\n$$('.nav [data-view]').forEach(button=>button.onclick=()=>navigate(button.dataset.view));\ndocument.addEventListener('click',async event=>{const target=event.target.closest('[data-new-mail],[data-goto],[data-open-campaign],[data-stop-subscriber],[data-restore-email]');if(!target)return;\n  if(target.hasAttribute('data-new-mail'))return newMail();\n  if(target.dataset.goto)return navigate(target.dataset.goto);\n  if(target.dataset.openCampaign)return openCampaign(target.dataset.openCampaign);\n  if(target.dataset.stopSubscriber){if(!await confirmAction('停止向此邮箱发信？',target.dataset.email+'\\n之后的更新邮件和感谢邮件都会跳过这个地址。','停止发信'))return;return buttonAction(target,async()=>{await api('/api/admin/subscribers/'+encodeURIComponent(target.dataset.stopSubscriber),{method:'PATCH',body:{action:'unsubscribe'}});toast('已停止向该邮箱发送后续邮件。');await loadSubscribers()})}\n  if(target.dataset.restoreEmail){const email=target.dataset.restoreEmail;if(!await confirmAction('解除退信抑制？',email+'\\n请确认退信原因已解决。解除后恢复后续投递资格，订阅状态保持原样，不会补发历史邮件。','解除抑制'))return;return buttonAction(target,async()=>{await post('/api/admin/bounces/restore',{email,confirmEmail:email});toast('已解除抑制。');await loadAutomation()})}\n});\n$('#refresh').onclick=()=>loadCurrent();$('#retry-load').onclick=()=>loadCurrent();\n$('#mail-search').addEventListener('input',renderCampaigns);$('#mail-filters').onclick=event=>{const button=event.target.closest('[data-filter]');if(!button)return;state.mailFilter=button.dataset.filter;$$('#mail-filters button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderCampaigns()};\n$$('[data-mail-back]').forEach(button=>button.onclick=()=>{if(state.mailBusy)return toast('请等待当前邮件操作完成。');showMailMode('list');loadCampaigns().catch(pageError);if(editorDirty() && (editorFields().subject || editorFields().body))toast('未保存的内容仍保留在编辑器中。点击“继续编辑”可返回。');$('#resume-editor').hidden=!(editorDirty() && (editorFields().subject || editorFields().body))});\n$('#resume-editor').onclick=()=>{showMailMode('editor');renderEditorStatus()};\n$('#mail-form').addEventListener('input',()=>{renderEditorStatus();$('#editor-error').hidden=true;for(const key of ['subject','body'])if(editorFields()[key]){$('#'+key+'-error').textContent='';$('#mail-'+key).removeAttribute('aria-invalid')}});\n$('#mail-form').addEventListener('change',renderEditorStatus);$('#mail-form').onsubmit=event=>{event.preventDefault();$('#prepare-send').click()};\n$('#save-mail').onclick=()=>mailAction($('#save-mail'),async()=>{await saveDraft();toast('草稿已保存。');await loadCampaigns()});\n$('#insert-mail-image').onclick=()=>{if(state.mailBusy)return;$('#mail-image-url').value='';$('#mail-image-alt').value='';$('#mail-image-error').textContent='';$('#mail-image-dialog').showModal();$('#mail-image-url').focus()};\n$('#close-mail-image').onclick=()=>$('#mail-image-dialog').close();\n$('#mail-image-form').onsubmit=event=>{\n  event.preventDefault();let url;\n  try {url=new URL($('#mail-image-url').value.trim());const host=url.hostname.toLowerCase();if(url.protocol!=='https:' || url.username || url.password || url.port && url.port!=='443' || !host.includes('.') || /^[\\d.]+$/.test(host) || host.includes(':') || /(?:^|\\.)(?:localhost|local|internal|test|invalid|lan|home)$/.test(host) || /\\.(?:svg|html?|js)$/i.test(url.pathname))throw new Error();url.hash=''}catch{$('#mail-image-error').textContent='请填写可公开访问的 HTTPS 图片地址。';$('#mail-image-url').focus();return}\n  const body=$('#mail-body'),alt=($('#mail-image-alt').value.trim() || 'MuseFilm 功能预览').replace(/[\\[\\]\\r\\n]/g,' '),insert='\\n\\n!['+alt+']('+url.href+')\\n\\n';\n  if(body.value.length-(body.selectionEnd-body.selectionStart)+insert.length>20000){$('#mail-image-error').textContent='正文已接近长度上限，请精简内容后再插入。';return}\n  body.setRangeText(insert,body.selectionStart,body.selectionEnd,'end');body.dispatchEvent(new Event('input',{bubbles:true}));$('#mail-image-dialog').close();body.focus();toast('图片已插入正文，点击“更新预览”查看效果。');\n};\n$('#preview-mail').onclick=()=>mailAction($('#preview-mail'),()=>saveDraft());$('#test-mail').onclick=()=>mailAction($('#test-mail'),()=>sendTest());$('#prepare-send').onclick=()=>mailAction($('#prepare-send'),()=>prepareSend());\n$('#review-action').onclick=()=>mailAction($('#review-action'),()=>reviewAction(),{dialog:true});\n$$('[data-close-review]').forEach(button=>button.onclick=()=>{if(!state.mailBusy)$('#send-review').close()});$('#send-review').addEventListener('cancel',event=>{if(state.mailBusy)event.preventDefault()});\n$('#refresh-delivery').onclick=()=>buttonAction($('#refresh-delivery'),()=>loadDelivery());$('#cancel-campaign').onclick=()=>cancelCampaign($('#cancel-campaign'));\n$('#retry-campaign').onclick=()=>buttonAction($('#retry-campaign'),async()=>{const r=await post('/api/admin/campaigns/'+encodeURIComponent(state.detailId)+'/retry');toast('已安排 '+number(r.retried)+' 个失败地址重试。');await loadDelivery()});\n$('#duplicate-mail').onclick=()=>{if(state.detail)newMail({subject:state.detail.subject,body:state.detail.body,audience:state.detail.audience})};\n$('#subscriber-filters').onsubmit=event=>{event.preventDefault();state.page=1;loadSubscribers().catch(pageError)};\n$('#reset-subscribers').onclick=()=>{$('#subscriber-filters').reset();state.page=1;loadSubscribers().catch(pageError)};\n$('#previous-page').onclick=()=>{if(state.page>1){state.page--;loadSubscribers().catch(pageError)}};$('#next-page').onclick=()=>{if(state.page*50<state.subscriberTotal){state.page++;loadSubscribers().catch(pageError)}};\n$('#export-subscribers').onclick=()=>buttonAction($('#export-subscribers'),async()=>{const response=await api('/api/admin/export?'+subscriberQuery(),{raw:true}),blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='musefilm-subscribers.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出当前筛选结果。')});\n$('#activity-tabs').onclick=event=>{const button=event.target.closest('[data-activity]');if(!button)return;state.activity=button.dataset.activity;$$('#activity-tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));$('#activity-search').value='';renderActivity();loadActivity().catch(pageError)};$('#activity-search').addEventListener('input',renderActivity);\n$('#feedback-list').addEventListener('change',async event=>{const select=event.target.closest('[data-feedback-status]');if(!select)return;const row=state.feedback.find(item=>item.id===select.dataset.feedbackStatus);if(!row)return;const previous=row.status,status=select.value;select.disabled=true;try{await api('/api/admin/feedback/'+encodeURIComponent(row.id),{method:'PATCH',body:{status}});row.status=status;renderActivity();toast('反馈状态已更新。')}catch(error){select.value=previous;toast(error.message,true)}finally{select.disabled=false}});\n$('#automation-form').addEventListener('change',renderSettingsSave);\n$('#automation-form').onsubmit=event=>{event.preventDefault();if(!state.settingsSig)return toast('请等待自动化设置加载完成。',true);const values=settingsValues(),signature=JSON.stringify(values);buttonAction($('#save-settings'),async()=>{await api('/api/admin/automation',{method:'PATCH',body:values});state.settingsSig=signature;toast('自动化设置已保存。');await loadAutomation()})};\nfor(const [id,path,message] of [['check-releases','check','版本检查完成。'],['check-imap','imap','IMAP 连接与退信检查完成。']])$('#'+id).onclick=()=>buttonAction($('#'+id),async()=>{try{const result=await post('/api/admin/automation/'+path);toast(result.busy?'已有检查在运行，请稍后刷新。':result.baseline?'已建立当前版本基线，没有补发历史邮件。':result.source==='github_snapshot'?'已通过发布快照完成版本检查。':message)}finally{await loadAutomation()}});\n$('#request-code').onclick=()=>buttonAction($('#request-code'),async()=>{const data=await post('/api/admin/login/request');state.challengeId=data.challengeId;$('#login-message').textContent='验证码已发送，请查看站长邮箱。';$('#login-message').style.color='var(--green)';$('#login-code').focus();setTimeout(()=>{let remaining=60;$('#request-code').disabled=true;$('#request-code').textContent=remaining+' 秒后重发';clearInterval(loginTimer);loginTimer=setInterval(()=>{remaining--;$('#request-code').textContent=remaining+' 秒后重发';if(remaining<=0){clearInterval(loginTimer);$('#request-code').disabled=false;$('#request-code').textContent='获取验证码'}},1000)},0)});\n$('#login-form').onsubmit=async event=>{event.preventDefault();$('#login-message').style.color='var(--red)';const code=$('#login-code').value.trim();if(!state.challengeId){$('#login-message').textContent='请先点击“获取验证码”。';return}if(!/^\\d{8}$/.test(code)){$('#login-message').textContent='请输入 8 位数字验证码。';return}await buttonAction($('#login-submit'),async()=>{try{await post('/api/admin/login',{challengeId:state.challengeId,code});$('#login-code').value='';await boot()}catch(error){$('#login-message').textContent=error.message}})};\n$('#logout').onclick=async()=>{if(editorDirty() && (editorFields().subject || editorFields().body) && !await confirmAction('退出登录？','当前页面的未保存邮件内容将被保留，重新登录后可继续编辑。','退出登录'))return;await buttonAction($('#logout'),async()=>{await post('/api/admin/logout');showLogin();state.challengeId='';state.mailConfig=null})};\nwindow.addEventListener('beforeunload',event=>{if(editorDirty() && (editorFields().subject || editorFields().body) || settingsDirty() || workflowsDirty()){event.preventDefault();event.returnValue=''}});\nasync function boot(){try{await api('/api/admin/session');$('#login').hidden=true;$('#dashboard').hidden=false;await Promise.all([getMailConfig(true),loadOverview(-1)]);const hash=location.hash.slice(1),view=names[hash]?hash:state.view;await navigate(view)}catch(error){if(error.status!==401)showLogin(error.message)}}\n$$('#automation-form input,#save-settings').forEach(control=>control.disabled=true);function workflowValues(){const f=$('#workflow-form').elements;return {releaseMode:f.releaseMode.value,weeklyEnabled:f.weeklyEnabled.checked,weeklyDay:Number(f.weeklyDay.value),weeklyTime:f.weeklyTime.value,followupEnabled:f.followupEnabled.checked,followupDays:Number(f.followupDays.value)}}\nfunction workflowsDirty(){return state.workflowSig && JSON.stringify(workflowValues())!==state.workflowSig}\nfunction renderWorkflowSave(){$('#workflow-save-state').textContent=workflowsDirty()?'有未保存的运营设置':'运营设置已保存'}\nfunction renderWorkflows(data){const s=data.settings;if(!s)return;state.workflows=s;const f=$('#workflow-form').elements;if(!workflowsDirty()){const values={releaseMode:s.release_mode,weeklyEnabled:Boolean(s.weekly_enabled),weeklyDay:s.weekly_day,weeklyTime:s.weekly_time,followupEnabled:Boolean(s.followup_enabled),followupDays:s.followup_days};for(const [key,value]of Object.entries(values)){if(typeof value==='boolean')f[key].checked=value;else f[key].value=value}state.workflowSig=JSON.stringify(values)}\n $$('#workflow-form input,#workflow-form select,#save-workflows').forEach(c=>c.disabled=false);$('#workflow-health').innerHTML=`<span class=\"badge ${s.last_error?'bad':'good'}\">${s.last_error?esc(s.last_error):'已配置'}</span>`;$('#weekly-meta').textContent=s.weekly_enabled?'下次计划：'+date(data.nextWeeklyAt)+'（北京时间）':'每周简报已关闭';$('#followup-meta').textContent='启用时间：'+date(s.activated_at)+' · 已提交回访 '+number(data.followups.find(r=>r.status==='sent')?.count)+' 封';$('#report-history').textContent=data.reports.length?data.reports.map(r=>date(r.period_end)+' · '+(deliveryNames[r.status]||r.status)+' · '+r.attempts+' 次'+(r.error_code?' · '+r.error_code:'')).join('\\n'):'尚无正式简报，将在下次计划时间自动发送。';renderWorkflowSave()}\n$('#workflow-form').addEventListener('change',renderWorkflowSave);\n$('#workflow-form').onsubmit=event=>{event.preventDefault();if(!state.workflowSig)return toast('请等待设置加载完成。',true);const values=workflowValues(),sig=JSON.stringify(values);buttonAction($('#save-workflows'),async()=>{await api('/api/admin/workflows',{method:'PATCH',body:values});state.workflowSig=sig;renderWorkflows(await api('/api/admin/workflows'));toast('运营自动化设置已保存。')})};\n$('#preview-report').onclick=()=>buttonAction($('#preview-report'),async()=>{const data=await api('/api/admin/workflows/report-preview');$('#report-preview-frame').srcdoc=data.html;$('#report-preview-dialog').showModal()});$('#close-report-preview').onclick=()=>$('#report-preview-dialog').close();\n$('#test-report').onclick=()=>buttonAction($('#test-report'),async()=>{await post('/api/admin/workflows/report-test');toast('简报测试已提交至站长邮箱，不会占用正式每周简报。')});\n$$('[data-release-draft]').forEach(button=>button.onclick=async()=>{buttonAction(button,async()=>{const data=await post('/api/admin/workflows/release-draft',{platform:button.dataset.releaseDraft});await openCampaign(data.id);toast(data.existing?'已打开该版本已有的审核邮件。':'版本草稿已生成，可预览、测试和审核发送。')})});\n$$('#workflow-form input,#workflow-form select,#save-workflows').forEach(c=>c.disabled=true);\nstate.editor.sig=editorSignature();$('#timezone-label').textContent='按本地时区 '+(Intl.DateTimeFormat().resolvedOptions().timeZone || '')+' 保存，关闭后台仍会到时发送。';\nconst memberTitles={plus:'Plus',pro:'Pro',bookDocument:'成册券',bookMotion:'影像券',legacy:'历史订单',trial:'Pro 试用',bookGift:'Plus 赠送项目'};\nconst memberStates={pending:'待发送',sending:'发送中',sent:'已提交',failed:'发送失败',uncertain:'待核实',historical:'历史记录',gift:'零元兑换',paused:'已暂停',available:'可领取',claimed:'已兑换',disabled:'已作废',expired:'已过期',approved:'已关联',rejected:'已拒绝'};\nlet memberAccount=null,memberAccountLoad=0,memberAccess=null,memberMessagePreview=null,memberMessageCreateId=null;\nlet memberTab='orders',memberData=null,memberDelivery=null,memberCreateId=null,memberReview=null,memberLoad=0;\nconst memberDate=n=>n?date(n*1000):'—';\nconst memberApi=(path,body={})=>post('/api/admin/membership/'+path,body);\nconst memberTone=s=>['sent','approved','claimed'].includes(s)?'good':['failed','uncertain','disabled','rejected'].includes(s)?'bad':'wait';\nconst memberBadge=s=>`<span class=\"badge ${memberTone(s)}\">${esc(memberStates[s]||s)}</span>`;\nfunction renderMemberOverview(data){memberData=data;$('#member-total').textContent=number(data.accounts);$('#member-active').textContent=number(data.activeMembers);$('#member-amount').textContent='¥'+(data.totals.amountFen/100).toLocaleString('zh-CN',{minimumFractionDigits:2});$('#member-attention').textContent=number(data.totals.attention);$('#member-mail-config').textContent=(data.settings.mailReady?'邮件服务已配置':'邮件服务尚未就绪')+' · '+(data.settings.ownerEmail||'未配置收件邮箱')+' · 自 '+memberDate(data.settings.enabledAt)+' 起';$('#member-notifications').disabled=false;$('#member-notifications').textContent=data.settings.enabled?'暂停到账提醒':'开启到账提醒';$('#member-orders').innerHTML=data.rows.map(r=>`<tr><td class=\"break\"><strong>${esc(r.order_id)}</strong><small>${esc(r.email||'尚未关联账号')}</small></td><td>${esc(memberTitles[r.product]||r.product)}<small>${r.amount_fen===null?'金额未提供':'¥'+(r.amount_fen/100).toFixed(2)}</small></td><td>${esc(memberDate(r.first_seen_at))}</td><td>${r.revoked?'已撤销':r.checkout_state==='credited'?'已到账':r.checkout_state==='verified'?'已核验，待同步':r.email?'已关联，查看账号有效期':'待关联账号'}</td><td>${memberBadge(r.notification_status)}<small>${esc(r.error_code||'')}</small></td><td>${['failed','uncertain'].includes(r.notification_status)?`<button class=\"small\" data-member-retry=\"${esc(r.order_id)}\" data-uncertain=\"${r.notification_status==='uncertain'}\">重试邮件</button>`:'—'}</td></tr>`).join('')||emptyRow(6,'尚无充值记录','真实订单核验后会自动显示。')}\nasync function loadMembership(){const seq=++memberLoad,viewToken=state.viewToken;const data=await memberApi('payments/overview');if(seq!==memberLoad||viewToken!==state.viewToken||state.view!=='membership')return;renderMemberOverview(data);await loadMemberTab()}\nasync function loadMemberTab(){const tab=memberTab,seq=++memberLoad,viewToken=state.viewToken;$$('[data-member-panel]').forEach(p=>p.hidden=p.dataset.memberPanel!==tab);$$('[data-member-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.memberTab===tab)));if(tab==='orders')return;\n const data=await memberApi(tab==='codes'?'codes/list':tab==='gifts'?'gifts/list':tab==='reports'?'exchange/reports':tab==='messages'?'messages/list':'accounts',tab==='accounts'?{query:$('#member-search').elements.query.value}:{});if(seq!==memberLoad||viewToken!==state.viewToken||state.view!=='membership')return;\n if(tab==='messages')renderClientMessageList(data);\n if(tab==='reports')$('#member-reports').innerHTML=data.reports.map(r=>`<tr><td class=\"break\">${esc(r.nickname)}<small>${esc(r.caption)}</small></td><td class=\"break\">${esc(r.reason)}</td><td>${esc(memberDate(r.createdAt))}</td><td>${esc(({open:'待处理',dismiss:'已忽略',hide:'已移除',block:'已暂停漂流'})[r.status]||r.status)}</td><td><button class=\"small\" data-member-preview=\"${esc(r.id)}\">查看副本</button> ${r.status==='open'?`<button class=\"small\" data-member-moderate=\"${esc(r.id)}\" data-member-action=\"dismiss\">忽略</button> <button class=\"small danger\" data-member-moderate=\"${esc(r.id)}\" data-member-action=\"hide\">移除副本</button> <button class=\"small danger\" data-member-moderate=\"${esc(r.id)}\" data-member-action=\"block\">暂停漂流</button>`:''}</td></tr>`).join('')||emptyRow(5,'暂无底片漂流举报');\n if(tab==='codes')$('#member-batches').innerHTML=data.batches.map(b=>`<tr><td>${esc(b.label||b.id.slice(0,8))}</td><td>${esc(memberTitles[b.product])} / ${number(b.durationDays)} 天</td><td>${number(b.count)} / ${number(b.claimed)} / ${number(b.disabled)}</td><td>${esc(memberDate(b.expiresAt))}</td><td><button class=\"small\" data-member-export=\"${esc(b.id)}\">查看 / 导出</button></td></tr>`).join('')||emptyRow(5,'暂无兑换码批次');\n if(tab==='accounts')$('#member-accounts').innerHTML=data.accounts.map(a=>`<tr><td>${esc(a.nickname||'光影旅人')}<small>${esc(a.email)}</small></td><td>${esc(memberDate(a.createdAt))}</td><td>${a.bannedAt!=null?'<span class=\"badge bad\">已封禁</span>':esc(memberTitles[a.tier]||'基础版')}<small>${a.memberExpiresAt>=253402300799?'永久会员':esc(memberDate(a.memberExpiresAt))}${a.manualCount?' · 含手动授予':''}</small></td><td>${number(a.redemptions)}</td><td><button class=\"small\" data-member-account=\"${esc(a.id)}\">管理账号</button></td></tr>`).join('')||emptyRow(5,'没有匹配的账号');\n if(tab==='gifts'){$('#member-gifts').innerHTML=data.requests.map(g=>`<tr><td>${esc(g.nickname||'光影旅人')}<small>${esc(g.email)}</small></td><td>${esc(g.providerUserId)}</td><td>${esc(g.orderId)}<small>${esc(memberTitles[g.tier])}</small></td><td>${memberBadge(g.status)}</td><td>${g.status==='pending'?`<button class=\"small\" data-member-review=\"${esc(g.id)}\">核验关联</button> <button class=\"small danger\" data-member-reject=\"${esc(g.id)}\">拒绝</button>`:'—'}</td></tr>`).join('')||emptyRow(5,'没有关联申请');memberData.gifts=data.requests;}\n}\nconst memberAvailableCodes=()=>memberDelivery?.codes.filter(c=>c.status==='available').map(c=>c.code)||[];\nconst memberCodeList=()=>memberAvailableCodes().map((code,index)=>$('#member-code-numbered').checked?(index+1)+'. '+code:code).join('\\n');\nfunction renderMemberCodeList(){const codes=memberAvailableCodes();$('#member-code-list').value=memberCodeList();$('#member-code-count').textContent='可用 '+codes.length+' 个 · 每行一个兑换码'+($('#member-code-numbered').checked?'，复制及 TXT 导出包含序号。':'，复制及 TXT 导出为纯码。');$('#member-copy').disabled=$('#member-txt').disabled=!codes.length;}\nfunction renderMemberDelivery(data){\n memberDelivery=data;\n $('#member-delivery').hidden=false;$('#member-delivery-title').textContent=(data.batch.label||'本批兑换码')+' · '+memberTitles[data.batch.product];\n renderMemberCodeList();\n $('#member-codes').innerHTML=data.codes.map(c=>`<tr><td><code style=\"user-select:all\">${esc(c.code)}</code></td><td>${memberBadge(c.status)}</td><td><button class=\"small\" data-member-code=\"${esc(c.id)}\">复制兑换码</button> <button class=\"small\" data-member-link=\"${esc(c.id)}\">复制领取链接</button> ${c.status==='available'?`<button class=\"small danger\" data-member-disable=\"${esc(c.id)}\">作废</button>`:''}</td></tr>`).join('');\n}\n$('#member-tabs').onclick=event=>{const b=event.target.closest('[data-member-tab]');if(b){memberTab=b.dataset.memberTab;loadMemberTab().catch(pageError)}};\n$('#member-reload').onclick=()=>buttonAction($('#member-reload'),loadMembership);\n$('#member-notifications').onclick=()=>buttonAction($('#member-notifications'),async()=>{await memberApi('payments/settings',{enabled:!memberData.settings.enabled});await loadMembership();toast('充值到账提醒设置已保存。')});\n$('#member-search').onsubmit=event=>{event.preventDefault();loadMemberTab().catch(pageError)};\n$('#member-create').oninput=()=>memberCreateId=null;\n$('#member-create').onsubmit=event=>{event.preventDefault();const f=event.currentTarget;buttonAction(f.querySelector('button[type=submit]'),async()=>{memberCreateId=memberCreateId||crypto.randomUUID();const data=await memberApi('codes/create',{batchId:memberCreateId,product:f.elements.product.value,count:Number(f.elements.count.value),durationDays:Number(f.elements.durationDays.value),validDays:Number(f.elements.validDays.value),label:f.elements.label.value});memberCreateId=null;renderMemberDelivery(data);await loadMemberTab();toast('兑换码已生成，可复制带序号的列表或导出 TXT、CSV。')})};\n$('#member-code-numbered').onchange=renderMemberCodeList;\n$('#member-copy').onclick=()=>buttonAction($('#member-copy'),async()=>{const codes=memberAvailableCodes();if(!codes.length)return;await navigator.clipboard.writeText(memberCodeList());toast('已复制 '+codes.length+' 个可用兑换码，每行一个。')});\n$('#member-txt').onclick=()=>{if(!memberAvailableCodes().length)return;const url=URL.createObjectURL(new Blob([memberCodeList()+'\\n'],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='MuseFilm-'+memberDelivery.batch.id+'-codes.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};\n$('#member-csv').onclick=()=>{if(!memberDelivery)return;const safe=v=>'\"'+String(v??'').replace(/^[=+\\-@\\t\\r]/,\"'$&\").replaceAll('\"','\"\"')+'\"';const rows=[['兑换码','产品','天数','领取截止','状态','领取链接'],...memberDelivery.codes.map(c=>[c.code,memberTitles[memberDelivery.batch.product],memberDelivery.batch.durationDays,memberDate(memberDelivery.batch.expiresAt),memberStates[c.status],c.redeemURL])];const url=URL.createObjectURL(new Blob(['\\uFEFF'+rows.map(r=>r.map(safe).join(',')).join('\\r\\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='MuseFilm-'+memberDelivery.batch.id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};\n$('#view-membership').addEventListener('click',async event=>{const b=event.target.closest('[data-member-message],[data-member-message-revoke],[data-member-account],[data-member-export],[data-member-code],[data-member-link],[data-member-disable],[data-member-retry],[data-member-review],[data-member-reject],[data-member-preview],[data-member-moderate]');if(!b)return;return buttonAction(b,async()=>{\n if(b.dataset.memberMessage)await openClientMessage(b.dataset.memberMessage);\n if(b.dataset.memberMessageRevoke&&await confirmAction('撤回这条客户端消息？','停止后续接收，已展示内容无法让用户忘记；在线客户端下次同步时隐藏横幅。','撤回消息')){await memberApi('messages/revoke',{messageId:b.dataset.memberMessageRevoke});await loadMemberTab();toast('客户端消息已撤回。')}\n if(b.dataset.memberAccount)await openMemberAccount(b.dataset.memberAccount);\n if(b.dataset.memberPreview){const data=await memberApi('exchange/preview',{reportId:b.dataset.memberPreview});$('#member-report-image').src=data.imageData;$('#member-report-preview').showModal()}\n if(b.dataset.memberModerate){const action=b.dataset.memberAction;if(!await confirmAction('处理这条底片举报？',action==='block'?'移除该副本并暂停分享者后续的底片漂流，账号和会员权益保持有效。':action==='hide'?'移除该副本，已保存到用户本机的文件无法撤回。':'将举报标记为已核查，不移除副本。','确认处理'))return;await memberApi('exchange/review',{reportId:b.dataset.memberModerate,action});await loadMemberTab();toast('举报处理已保存。')}\n if(b.dataset.memberExport)renderMemberDelivery(await memberApi('codes/export',{batchId:b.dataset.memberExport}));\n if(b.dataset.memberCode){await navigator.clipboard.writeText(memberDelivery.codes.find(c=>c.id===b.dataset.memberCode).code);toast('兑换码已复制。')}\n if(b.dataset.memberLink){await navigator.clipboard.writeText(memberDelivery.codes.find(c=>c.id===b.dataset.memberLink).redeemURL);toast('领取链接已复制。')}\n if(b.dataset.memberDisable&&await confirmAction('作废这个兑换码？','仅限未领取的兑换码，已兑换会员不会被撤销。','作废')){await memberApi('codes/disable',{codeId:b.dataset.memberDisable});renderMemberDelivery(await memberApi('codes/export',{batchId:memberDelivery.batch.id}));await loadMemberTab()}\n if(b.dataset.memberRetry){const uncertain=b.dataset.uncertain==='true';if(!await confirmAction('重新提交到账邮件？',uncertain?'此前邮件可能已到达。请先核对收件箱，重发可能产生重复邮件。':'将向已配置的站长邮箱重试这一笔充值提醒。','确认重试'))return;await memberApi('payments/retry',{orderId:b.dataset.memberRetry,confirmDuplicateRisk:uncertain});await loadMembership();toast('已安排重试，稍后刷新查看投递状态。')}\n if(b.dataset.memberReview){memberReview=memberData.gifts.find(g=>g.id===b.dataset.memberReview);$('#member-review-summary').textContent=memberReview.email+' ↔ '+memberReview.providerUserId+' · '+memberReview.orderId;$('#member-review-form').reset();$('#member-review-dialog').showModal()}\n if(b.dataset.memberReject&&await confirmAction('拒绝此关联申请？','用户现有的会员权益不会被撤销。','拒绝申请')){await memberApi('gifts/review',{requestId:b.dataset.memberReject,action:'reject'});await loadMemberTab()}\n})});\n$('#member-review-cancel').onclick=()=>$('#member-review-dialog').close();\n$('#member-review-form').onsubmit=event=>{event.preventDefault();buttonAction(event.currentTarget.querySelector('button[type=submit]'),async()=>{await memberApi('gifts/review',{requestId:memberReview.id,action:'approve',bindingCode:$('#member-review-code').value.trim(),identityConfirmed:$('#member-review-confirm').checked});$('#member-review-dialog').close();await loadMemberTab();toast('账号关联与会员核验已完成。')})};\nwindow.addEventListener('pagehide',clearMemberData);\n\nfunction clearMemberData(){closeClientMessage();$('#member-message-form').reset();updateClientMessageForm();memberMessageCreateId=null;$('#member-message-list').replaceChildren();closeMemberAccount();memberLoad++;memberData=null;memberDelivery=null;memberReview=null;for(const id of [\"member-codes\",\"member-orders\",\"member-batches\",\"member-accounts\",\"member-gifts\",\"member-reports\"])$(\"#\"+id).replaceChildren();$('#member-code-list').value='';$('#member-code-count').textContent='';$('#member-copy').disabled=$('#member-txt').disabled=true;$(\"#member-delivery\").hidden=true;}\n\nconst memberManagementTitles={admin_membership_granted:'授予会员',admin_membership_revoked:'取消手动授予',account_banned:'封禁账号',account_unbanned:'解除封禁',account_access_updated:'修改权益期限',account_access_cancelled:'取消权益',account_access_restored:'恢复原始权益'};\nfunction renderMemberAccount(data){\n memberAccount=data;const a=data.account,banned=a.bannedAt!=null;\n $('#member-account-title').textContent=(a.nickname||'光影旅人')+' · 账号管理';$('#member-account-email').textContent=a.email;\n $('#member-account-state').textContent=banned?'已封禁 · '+memberDate(a.bannedAt):'账号正常 · 当前权益：'+(memberTitles[a.tier]||'基础版');\n $('#member-account-ban-reason').textContent=banned?'封禁原因：'+a.banReason:'';\n $('#member-account-status').textContent=banned?'解除封禁':'封禁账号';$('#member-grant-submit').disabled=banned;\n $('#member-account-grants').innerHTML=[...data.grants,...(data.access||[])].map(g=>`<tr><td>${esc(memberTitles[g.tier]||g.tier)}${g.projectId?'<small>项目 '+esc(g.projectId)+'</small>':''}</td><td>${g.expiresAt>=253402300799?'永久有效':esc(memberDate(g.expiresAt))}${g.overriddenAt?'<small>人工调整中</small>':''}</td><td>${esc(({manual:'手动授予',afdian:'爱发电',code:'兑换码',trial:'试用',voucher:'创作券',bookGift:'Plus 赠送'})[g.provider]||g.provider)}<small>${g.revoked?'已取消':g.active?'有效':'已到期'}</small></td><td><div class=\"inline-actions\"><button type=\"button\" class=\"small\" data-member-access=\"${esc(g.id)}\" data-access-kind=\"${esc(g.kind)}\">修改期限</button>${g.active?`<button type=\"button\" class=\"small danger\" data-member-access-cancel=\"${esc(g.id)}\" data-access-kind=\"${esc(g.kind)}\">取消权益</button>`:''}${g.overriddenAt?`<button type=\"button\" class=\"small\" data-member-access-restore=\"${esc(g.id)}\" data-access-kind=\"membership\">恢复原值</button>`:''}</div></td></tr>`).join('')||emptyRow(4,'暂无会员权益');\n $('#member-account-history').innerHTML=data.history.map(h=>`<p>${esc(memberDate(h.createdAt))} · ${esc(memberManagementTitles[h.kind]||h.kind)}${h.tier?' '+esc(memberTitles[h.tier]):''}${['admin_membership_granted','account_access_updated'].includes(h.kind)?' · '+(h.permanent?'永久':esc(memberDate(h.expiresAt))):''}<br>${esc(h.reason||'')}</p>`).join('')||'暂无管理操作。';\n}\nasync function openMemberAccount(accountId){\n const seq=++memberAccountLoad,viewToken=state.viewToken;\n const data=await memberApi('accounts/detail',{accountId});\n if(seq!==memberAccountLoad||viewToken!==state.viewToken||state.view!=='membership')return;\n $('#member-account-form').reset();$('#member-grant-days').disabled=false;$('#member-grant-duration').hidden=false;\n renderMemberAccount(data);$('#member-account-dialog').showModal();\n}\nfunction closeMemberAccount(){closeMemberAccess();memberAccountLoad++;memberAccount=null;if($('#member-account-dialog').open)$('#member-account-dialog').close();for(const id of ['member-account-title','member-account-email','member-account-state','member-account-ban-reason','member-account-grants','member-account-history'])$('#'+id).replaceChildren();$('#member-account-reason').value='';}\nfunction memberManagementBody(reasonValue=$('#member-account-reason').value){\n if(!memberAccount)throw new Error('请重新打开账号资料。');\n const reason=reasonValue.trim();if(!reason)throw new Error('请先填写操作原因。');\n return {accountId:memberAccount.account.id,expectedRevision:memberAccount.account.revision,reason};\n}\nasync function saveMemberManagement(action,body){\n const seq=memberAccountLoad,viewToken=state.viewToken;\n let data;try{data=await memberApi('accounts/'+action,body)}catch(error){if(error.status===409&&seq===memberAccountLoad&&memberAccount?.account.id===body.accountId)renderMemberAccount(await memberApi('accounts/detail',{accountId:body.accountId}));throw error}\n if(seq!==memberAccountLoad||viewToken!==state.viewToken||state.view!=='membership')return;\n renderMemberAccount(data);$('#member-account-reason').value='';await loadMembership();toast('账号管理操作已保存。');\n}\n$('#member-account-close').onclick=closeMemberAccount;\n$('#member-account-dialog').addEventListener('cancel',event=>{event.preventDefault();closeMemberAccount()});\n$('#member-grant-permanent').onchange=()=>{const permanent=$('#member-grant-permanent').checked;$('#member-grant-duration').hidden=permanent;$('#member-grant-days').disabled=permanent;};\n$('#member-account-form').onsubmit=event=>{event.preventDefault();buttonAction($('#member-grant-submit'),async()=>{\n const body={...memberManagementBody(),tier:$('#member-grant-tier').value,permanent:$('#member-grant-permanent').checked,durationDays:Number($('#member-grant-days').value)};\n if(!await confirmAction('授予 '+memberTitles[body.tier]+' 会员？',memberAccount.account.email+' · '+(body.permanent?'永久会员':body.durationDays+' 天')+'。将替换同档位的手动授予，其他权益保留。','确认授予'))return;\n await saveMemberManagement('grant',body);\n})};\n$('#member-account-grants').addEventListener('click',event=>{const b=event.target.closest('[data-member-revoke]');if(!b)return;buttonAction(b,async()=>{\n const body={...memberManagementBody(),tier:b.dataset.memberRevoke};\n if(!await confirmAction('取消 '+memberTitles[body.tier]+' 手动授予？',memberAccount.account.email+' 的该档手动赠送将失效，购买及兑换权益继续保留。','取消授予'))return;\n await saveMemberManagement('revoke',body);\n})});\n$('#member-account-status').onclick=async()=>{await buttonAction($('#member-account-status'),async()=>{\n const body={...memberManagementBody(),banned:memberAccount.account.bannedAt==null};\n if(!await confirmAction(body.banned?'封禁此账号？':'解除账号封禁？',memberAccount.account.email+' · '+(body.banned?'立即注销服务端会话并阻止再次登录；离线缓存授权可能暂时保留。':'允许重新登录，原有未过期权益恢复可用。'),body.banned?'封禁账号':'解除封禁'))return;\n await saveMemberManagement('status',body);\n});if(memberAccount)renderMemberAccount(memberAccount)};\n\nfunction closeMemberAccess(){memberAccess=null;if($('#member-access-dialog').open)$('#member-access-dialog').close();$('#member-access-reason').value='';}\n$('#member-access-close').onclick=closeMemberAccess;\n$('#member-access-dialog').addEventListener('cancel',event=>{event.preventDefault();closeMemberAccess()});\n$('#member-access-permanent').onchange=()=>$('#member-access-expiry').disabled=$('#member-access-permanent').checked;\n$('#member-account-grants').addEventListener('click',event=>{\n const b=event.target.closest('[data-member-access],[data-member-access-cancel],[data-member-access-restore]');if(!b||!memberAccount)return;\n const sourceId=b.dataset.memberAccess||b.dataset.memberAccessCancel||b.dataset.memberAccessRestore;\n const target=[...memberAccount.grants,...(memberAccount.access||[])].find(g=>g.kind===b.dataset.accessKind&&g.id===sourceId);if(!target)return;\n if(b.dataset.memberAccess){\n  memberAccess=target;$('#member-access-title').textContent='修改 '+(memberTitles[target.tier]||target.tier)+' 期限';\n  $('#member-access-summary').textContent=memberAccount.account.email+' · 当前：'+(target.expiresAt>=253402300799?'永久有效':memberDate(target.expiresAt));\n  const time=target.expiresAt>=253402300799||target.expiresAt<Date.now()/1000?Date.now()+31*86400000:target.expiresAt*1000,d=new Date(time);\n  $('#member-access-expiry').value=new Date(time-d.getTimezoneOffset()*60000).toISOString().slice(0,16);\n  $('#member-access-permanent').checked=target.expiresAt>=253402300799;$('#member-access-expiry').disabled=$('#member-access-permanent').checked;\n  $('#member-access-reason').value=$('#member-account-reason').value;$('#member-access-dialog').showModal();return;\n }\n buttonAction(b,async()=>{\n  const action=b.dataset.memberAccessCancel?'cancel':'restore',body={...memberManagementBody(),kind:target.kind,sourceId:target.id,action};\n  if(!await confirmAction(action==='cancel'?'取消这条权益？':'恢复原始权益？',memberAccount.account.email+' · '+(memberTitles[target.tier]||target.tier)+'。'+(action==='cancel'?'此来源的授权会失效，其他权益独立保留。':'移除这条人工调整，恢复原始记录；平台来源后续按平台同步。'),action==='cancel'?'取消权益':'恢复原值'))return;\n  await saveMemberManagement('access',body);\n });\n});\n$('#member-access-form').onsubmit=event=>{event.preventDefault();const target=memberAccess;if(!target)return;buttonAction(event.currentTarget.querySelector('button[type=submit]'),async()=>{\n const body={...memberManagementBody($('#member-access-reason').value),kind:target.kind,sourceId:target.id,action:'update',permanent:$('#member-access-permanent').checked,expiresAt:Math.floor(new Date($('#member-access-expiry').value).getTime()/1000)};\n if(!await confirmAction('保存新的权益期限？',memberAccount.account.email+' · '+(memberTitles[target.tier]||target.tier)+' → '+(body.permanent?'永久有效':memberDate(body.expiresAt))+'。人工修改会覆盖自动同步。','保存期限'))return;\n await saveMemberManagement('access',body);closeMemberAccess();\n})};\n\nconst clientAudienceTitles={single:'单个账号',all:'全部正常账号',plus:'Plus 账号',pro:'Pro 账号',free:'无有效订阅（含试用）'};\nconst clientMessageStates={draft:'待确认',sent:'已发送',revoked:'已撤回'};\nfunction renderClientMessageList(data){$('#member-message-list').innerHTML=data.messages.map(m=>`<tr><td>${esc(m.title)}<small>${m.kind==='toast'?'Toast 轻量提示':'Alert 横幅'}</small></td><td>${esc(m.accountEmail||clientAudienceTitles[m.audience])}</td><td>${esc(clientMessageStates[m.status])}<small>${number(m.shown)} / ${number(m.recipients)} 个账号已展示</small></td><td>${esc(memberDate(m.expiresAt))}</td><td><div class=\"inline-actions\"><button class=\"small\" data-member-message=\"${esc(m.id)}\">${m.status==='draft'?'预览 / 发送':'查看'}</button>${m.status!=='revoked'?`<button class=\"small danger\" data-member-message-revoke=\"${esc(m.id)}\">撤回</button>`:''}</div></td></tr>`).join('')||emptyRow(5,'暂无客户端消息');}\nfunction renderClientMessagePreview(data){\n memberMessagePreview=data;const m=data.message;\n $('#member-message-preview-title').textContent=m.kind==='toast'?'Toast 轻量提示预览':'Alert 顶部横幅预览';\n $('#member-message-preview-heading').textContent=m.title;$('#member-message-preview-body').textContent=m.body;\n $('#member-message-preview-meta').textContent=(m.accountEmail||clientAudienceTitles[m.audience])+' · '+data.eligibleCount+' 个账号 · 有效至 '+memberDate(m.expiresAt);\n $('#member-message-preview-progress').textContent=m.status==='draft'?'未发送。确认后固定本次收件账号范围；需要新版客户端才能展示。':clientMessageStates[m.status]+' · '+data.progress.shown+' / '+data.progress.recipients+' 个账号已展示。';\n $('#member-message-send').hidden=m.status!=='draft';$('#member-message-send').disabled=data.eligibleCount<1||m.expiresAt<=Date.now()/1000;\n $('#member-message-send').textContent='确认发送给 '+data.eligibleCount+' 个账号';\n}\nasync function openClientMessage(messageId){const token=state.viewToken,data=await memberApi('messages/detail',{messageId});if(token!==state.viewToken||state.view!=='membership')return;renderClientMessagePreview(data);$('#member-message-preview-dialog').showModal();}\nfunction closeClientMessage(){memberMessagePreview=null;if($('#member-message-preview-dialog').open)$('#member-message-preview-dialog').close();for(const id of ['member-message-preview-heading','member-message-preview-body','member-message-preview-meta','member-message-preview-progress'])$('#'+id).replaceChildren();}\n$('#member-message-preview-close').onclick=closeClientMessage;\n$('#member-message-preview-dialog').addEventListener('cancel',event=>{event.preventDefault();closeClientMessage()});\nfunction updateClientMessageForm(){const single=$('#member-message-audience').value==='single',toastStyle=$('#member-message-kind').value==='toast';$('#member-message-target-wrap').hidden=!single;$('#member-message-target').required=single;$('#member-message-body').maxLength=toastStyle?140:1000;$('#member-message-hint').textContent=toastStyle?'Toast 正文最多 140 字，约 6 秒后自动消失。':'Alert 正文最多 1000 字，作为顶部横幅保留，用户可关闭。';}\n$('#member-message-audience').onchange=updateClientMessageForm;$('#member-message-kind').onchange=updateClientMessageForm;\n$('#member-message-form').oninput=()=>memberMessageCreateId=null;\n$('#member-message-form').onsubmit=event=>{event.preventDefault();const token=state.viewToken;buttonAction(event.currentTarget.querySelector('button[type=submit]'),async()=>{\n memberMessageCreateId=memberMessageCreateId||crypto.randomUUID();\n const data=await memberApi('messages/draft',{requestId:memberMessageCreateId,kind:$('#member-message-kind').value,audience:$('#member-message-audience').value,target:$('#member-message-target').value,title:$('#member-message-title').value,body:$('#member-message-body').value,validDays:Number($('#member-message-valid').value)});\n if(token!==state.viewToken||state.view!=='membership')return;renderClientMessagePreview(data);$('#member-message-preview-dialog').showModal();await loadMemberTab();\n})};\n$('#member-message-send').onclick=async()=>{await buttonAction($('#member-message-send'),async()=>{\n const preview=memberMessagePreview;if(!preview||preview.message.status!=='draft')return;\n if(!await confirmAction('发送这条客户端消息？',preview.message.title+' · '+preview.eligibleCount+' 个账号 · '+(preview.message.kind==='toast'?'Toast 轻量提示':'Alert 顶部横幅')+'。这会向真实客户端投递。','确认发送'))return;\n try{const data=await memberApi('messages/send',{messageId:preview.message.id,confirmRecipientCount:preview.eligibleCount});if(memberMessagePreview?.message.id===preview.message.id)renderClientMessagePreview(data);await loadMemberTab();toast('客户端消息已发送，等待用户上线接收。')}\n catch(error){if(error.status===409&&memberMessagePreview?.message.id===preview.message.id)renderClientMessagePreview(await memberApi('messages/detail',{messageId:preview.message.id}));throw error}\n});if(memberMessagePreview)renderClientMessagePreview(memberMessagePreview)};\n$('#member-account-message').onclick=()=>{if(!memberAccount)return;const email=memberAccount.account.email;closeMemberAccount();memberTab='messages';$('#member-message-audience').value='single';$('#member-message-target').value=email;memberMessageCreateId=null;updateClientMessageForm();loadMemberTab().catch(pageError)};\n\n$('#member-report-close').onclick=()=>{$('#member-report-preview').close();$('#member-report-image').removeAttribute('src')};\n\nboot();\n\n</script>\n</body></html>\n";
// Safe Markdown images for campaign previews, plain-text fallbacks and QQ MIME.
// No raw HTML is accepted. Only public MuseFilm resources are fetched by the Worker.
const EMAIL_IMAGE_LIMIT = 6;
const EMAIL_IMAGE_BYTES = 3 * 1024 * 1024;
const EMAIL_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;
const emailImagePattern = () => /!\[([^\]\r\n]{0,300})\]\((https:\/\/[^\s<>]+?)\)/gi;

function emailImageUrl(value) {
  if(typeof value!=='string' || value.length>2048 || /[\s<>\\\u0000-\u001f]/.test(value))return null;
  try {
    const u=new URL(value),host=u.hostname.toLowerCase();
    if(u.protocol!=='https:' || u.username || u.password || u.port && u.port!=='443' || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /(?:^|\.)(?:localhost|local|internal|test|invalid|lan|home)$/.test(host) || /\.(?:svg|html?|js)$/i.test(u.pathname))return null;
    u.hash='';return u.href;
  }catch{return null}
}

function trustedEmailImage(value) {
  const safe=emailImageUrl(value);if(!safe)return false;
  const u=new URL(safe),h=u.hostname.toLowerCase();
  if(['musefilm.top','www.musefilm.top'].includes(h))return true;
  if(h==='github.com')return /^\/Quartzsyr\/MuseFilm\/releases\/download\/[^/]+\/[^/]+$/i.test(u.pathname);
  if(h==='raw.githubusercontent.com')return /^\/Quartzsyr\/MuseFilm\//i.test(u.pathname);
  return ['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(h);
}

function emailInlineText(value) {
  // Escape first: Markdown never provides a route for arbitrary attributes/HTML.
  return escapeHtml(value).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`\n]+)`/g,'<code>$1</code>')
    .replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g,(match,label,url)=>{
      const safe=emailImageUrl(url.replace(/&amp;/g,'&'));return safe?`<a href="${escapeHtml(safe)}" style="color:#d4b69a">${label}</a>`:match;
    });
}

function campaignBodyContent(body) {
  const source=String(body || '').slice(0,20000),html=[],plain=[],images=[];
  let cursor=0;
  const prose=value=>{
    if(!value.trim())return;
    for(const part of value.split(/\n\s*\n/)) {
      if(!part.trim())continue;
      html.push(`<p style="color:#c4bfb7;font-size:15px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere">${emailInlineText(part.trim())}</p>`);
      plain.push(part.trim().replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,'$1（$2）'));
    }
  };
  for(const match of source.matchAll(emailImagePattern())) {
    prose(source.slice(cursor,match.index));cursor=match.index+match[0].length;
    const url=emailImageUrl(match[2]),alt=match[1].trim() || 'MuseFilm 功能预览';
    if(!url){prose(match[0]);continue}
    plain.push(`图片：${alt}\n${url}`);
    if(images.length>=EMAIL_IMAGE_LIMIT){html.push(`<p style="font-size:13px"><a href="${escapeHtml(url)}" style="color:#d4b69a">查看图片：${escapeHtml(alt)}</a></p>`);continue}
    images.push({url,alt});
    html.push(`<div style="margin:24px 0"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" width="532" referrerpolicy="no-referrer" style="display:block;width:100%;max-width:532px;height:auto;border:0;border-radius:12px;background:#242321"><p style="margin:9px 0 0;color:#a49b8e;font-size:12px;line-height:1.6">${escapeHtml(alt)}</p></div>`);
  }
  prose(source.slice(cursor));
  return {html:html.join(''),text:plain.join('\n\n'),images};
}

async function readEmailImage(response,signal) {
  if(Number(response.headers.get('Content-Length'))>EMAIL_IMAGE_BYTES){await response.body?.cancel();throw new Error('IMAGE_TOO_LARGE')}
  const reader=response.body?.getReader();if(!reader)throw new Error('NO_IMAGE_BODY');
  const chunks=[];let length=0,complete=false;
  try {
    while(true){if(signal.aborted)throw new Error('IMAGE_TIMEOUT');const {done,value}=await reader.read();if(done){complete=true;break}length+=value.byteLength;if(length>EMAIL_IMAGE_BYTES)throw new Error('IMAGE_TOO_LARGE');chunks.push(value)}
  }finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock()}
  if(!length)throw new Error('EMPTY_IMAGE');
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes;
}

function emailImageType(bytes) {
  if(bytes.length>=8 && [137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return 'image/png';
  if(bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'image/jpeg';
  const head=new TextDecoder().decode(bytes.slice(0,12));
  if(/^GIF8[79]a/.test(head))return 'image/gif';
  if(head.startsWith('RIFF') && head.slice(8)==='WEBP')return 'image/webp';
  return null;
}

async function prepareInlineEmailImages(message,fetcher=fetch) {
  const attachments=[],seen=new Set(),signal=AbortSignal.timeout(8000);let total=0,html=String(message.html || '');
  for(const image of (message.emailImages || []).slice(0,EMAIL_IMAGE_LIMIT)) {
    if(signal.aborted)break;
    if(!trustedEmailImage(image.url) || seen.has(image.url))continue;seen.add(image.url);
    try {
      let url=image.url,response;
      for(let redirects=0;redirects<=3;redirects++) {
        if(!trustedEmailImage(url))throw new Error('UNTRUSTED_IMAGE_REDIRECT');
        response=await fetcher(url,{redirect:'manual',headers:{Accept:'image/png,image/jpeg,image/gif,image/webp'},signal});
        if(![301,302,303,307,308].includes(response.status))break;
        const location=response.headers.get('Location');await response.body?.cancel();
        if(!location || redirects===3)throw new Error('IMAGE_REDIRECT_LIMIT');url=new URL(location,url).href;
      }
      if(!response?.ok)throw new Error('IMAGE_UNAVAILABLE');
      const declared=response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
      // GitHub Release assets are often served as octet-stream. Validate their
      // actual file signature rather than trusting an extension or that header.
      if(!['image/png','image/jpeg','image/gif','image/webp','application/octet-stream'].includes(declared)) {await response.body?.cancel();throw new Error('INVALID_IMAGE_TYPE')}
      const bytes=await readEmailImage(response,signal),type=emailImageType(bytes);
      if(!type || declared!=='application/octet-stream' && type!==declared || total+bytes.length>EMAIL_TOTAL_IMAGE_BYTES)continue;
      const id=`mf-image-${attachments.length+1}@musefilm.top`;
      attachments.push({id,type,bytes});total+=bytes.length;
      html=html.replaceAll(`src="${escapeHtml(image.url)}"`,`src="cid:${id}"`);
    }catch{/* Keep the original HTTPS image when download/size/type checks fail. */}
  }
  return {...message,html,inlineImages:attachments};
}

function emailBytesBase64(bytes) {
  let binary='';for(let start=0;start<bytes.length;start+=32768)binary+=String.fromCharCode(...bytes.subarray(start,start+32768));
  return btoa(binary).match(/.{1,76}/g)?.join('\r\n') || '';
}

// Embedded in worker.js by scripts/bundle-community.mjs for dashboard deployment.
const CONSENT_VERSION = "2026-10-20"; // Legacy checkbox flow, retained for cached clients.
const DIRECT_CONSENT_VERSION = "2026-10-20-email-subscription-v2";
const COMMUNITY_ORIGIN = "https://api.musefilm.top";

function communityMailReady(env) {
  return Boolean(env.SMTP_PASSWORD && validEmail(env.SMTP_USER || env.FEEDBACK_TO_EMAIL) || env.SUBSCRIBER_EMAIL);
}

function smtpMime(message, user) {
  const wrap = value => emailBytesBase64(new TextEncoder().encode(String(value || "")));
  const encode = value => wrap(value).replace(/\r\n/g,'');
  const boundary = "musefilm-"+crypto.randomUUID();
  if (!validEmail(message.to) || !validEmail(user)) throw Object.assign(new Error("Invalid recipient"),{code:"SMTP_INVALID_ADDRESS"});
  const headers = ["From: MuseFilm <"+user+">","To: <"+message.to+">","Subject: =?UTF-8?B?"+encode(String(message.subject || "").replace(/[\r\n]/g," "))+"?=","Date: "+new Date().toUTCString(),"Message-ID: <"+(/^[a-z0-9-]+@musefilm\.top$/.test(message.messageId || "") ? message.messageId : crypto.randomUUID()+"@musefilm.top")+">","MIME-Version: 1.0"];
  if (validEmail(message.replyTo)) headers.push("Reply-To: <"+message.replyTo+">");
  const alternative='Content-Type: multipart/alternative; boundary="'+boundary+'"';
  const parts="--"+boundary+"\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"+wrap(message.text)+"\r\n--"+boundary+"\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"+wrap(message.html)+"\r\n--"+boundary+"--\r\n";
  const images=(message.inlineImages || []).slice(0,EMAIL_IMAGE_LIMIT).filter(i=>/^mf-image-\d+@musefilm\.top$/.test(i.id || '') && i.bytes instanceof Uint8Array && i.bytes.length<=EMAIL_IMAGE_BYTES && emailImageType(i.bytes)===i.type);
  if(!images.length)return [...headers,alternative].join('\r\n')+'\r\n\r\n'+parts;
  const related='musefilm-related-'+crypto.randomUUID();
  headers.push('Content-Type: multipart/related; type="multipart/alternative"; boundary="'+related+'"');
  return headers.join('\r\n')+'\r\n\r\n--'+related+'\r\n'+alternative+'\r\n\r\n'+parts+images.map((image,index)=>'--'+related+'\r\nContent-Type: '+image.type+'\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <'+image.id+'>\r\nContent-Disposition: inline; filename="musefilm-'+(index+1)+'.'+({"image/png":"png","image/jpeg":"jpg","image/gif":"gif","image/webp":"webp"}[image.type])+'"\r\n\r\n'+emailBytesBase64(image.bytes)+'\r\n').join('')+'--'+related+'--\r\n';
}

async function sendQqSmtp(env,message,connectOverride) {
  const user=env.SMTP_USER || env.FEEDBACK_TO_EMAIL;
  if(!env.SMTP_PASSWORD || !validEmail(user)) throw Object.assign(new Error("QQ SMTP not configured"),{code:"SMTP_NOT_CONFIGURED"});
  const mime=smtpMime(message,user);
  const connect=connectOverride || (await import("node:tls")).connect;
  const socket=connect({host:"smtp.qq.com",port:465,servername:"smtp.qq.com",rejectUnauthorized:true});
  let buffer="",pending=null,failed=null,stage="connect",bodySubmitted=false;const replies=[];
  const deadline=setTimeout(()=>{fail(Object.assign(new Error("SMTP deadline"),{code:"SMTP_TIMEOUT"}));socket.destroy()},20000);
  const fail=error=>{failed=error;if(pending){pending.reject(error);pending=null}};
  socket.on("error",()=>fail(Object.assign(new Error("SMTP connection failed"),{code:"SMTP_CONNECTION_FAILED"})));
  socket.on("close",()=>fail(Object.assign(new Error("SMTP connection closed"),{code:"SMTP_CONNECTION_CLOSED"})));
  socket.setTimeout(15000,()=>{fail(Object.assign(new Error("SMTP timeout"),{code:"SMTP_TIMEOUT"}));socket.destroy()});
  socket.on("data",chunk=>{
    buffer+=chunk.toString();if(buffer.length>131072){fail(Object.assign(new Error("SMTP reply too large"),{code:"SMTP_BAD_REPLY"}));socket.destroy();return}
    let end;
    while((end=buffer.indexOf("\r\n"))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);if(/^\d{3} /.test(line)){const code={number:Number(line.slice(0,3)),enhanced:line.match(/\b([245]\.\d{1,3}\.\d{1,3})\b/)?.[1] || ""};if(pending){const current=pending;pending=null;current.resolve(code)}else replies.push(code)}}
  });
  const reply=()=>failed?Promise.reject(failed):replies.length?Promise.resolve(replies.shift()):new Promise((resolve,reject)=>{pending={resolve,reject}});
  const expect=async code=>{const received=await reply();if(received.number!==code)throw Object.assign(new Error("SMTP rejected command"),{code:"SMTP_"+received.number,enhanced:received.enhanced})};
  const command=async(line,code)=>{await new Promise((resolve,reject)=>socket.write(line+"\r\n",error=>error?reject(error):resolve()));await expect(code)};
  const encode=value=>btoa(String.fromCharCode(...new TextEncoder().encode(value)));
  try {
    await expect(220);stage="ehlo";await command("EHLO musefilm.top",250);stage="auth";await command("AUTH LOGIN",334);await command(encode(user),334);await command(encode(env.SMTP_PASSWORD),235);
    stage="mail";await command("MAIL FROM:<"+user+">",250);stage="rcpt";await command("RCPT TO:<"+message.to+">",250);stage="data";await command("DATA",354);
    stage="data_ack";bodySubmitted=true;await command(mime.replace(/(^|\r\n)\./g,"$1..")+"\r\n.",250);
    // Successful DATA acknowledgement is the delivery boundary; QUIT is best effort.
    socket.write("QUIT\r\n");return {accepted:true};
  } catch(error) {error.stage=stage;error.uncertain=bodySubmitted && !/^SMTP_\d{3}$/.test(error.code || "");throw error}
  finally {clearTimeout(deadline);socket.end();socket.destroy()}
}

async function sendCommunityMail(env,message) {
  if(env.SMTP_PASSWORD) return sendQqSmtp(env,await prepareInlineEmailImages(message));
  if(env.SUBSCRIBER_EMAIL) return env.SUBSCRIBER_EMAIL.send(message);
  throw Object.assign(new Error("QQ SMTP not configured"),{code:"SMTP_NOT_CONFIGURED"});
}

function communityHtml(content, title = "MuseFilm", emailPreview = false) {
  return new Response(content, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:"+(emailPreview?' https:':'')+"; frame-src 'self' about:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
}

function communityMessage(title, body, action = "") {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · MuseFilm</title><style>html{color-scheme:dark}body{margin:0;padding:12vh 24px;background:#080808;color:#f2efe8;font:16px/1.8 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}main{max-width:520px;margin:auto;padding:36px;border:1px solid #39332f;border-radius:24px;background:radial-gradient(at top right,#35201e,transparent 65%),#131312}small{color:#d05248;letter-spacing:.15em}h1{font-size:32px;line-height:1.2;letter-spacing:-.05em}p{color:#aaa59e}button,a.button{display:inline-block;border:1px solid #d05248;border-radius:99px;padding:12px 20px;color:#fff;background:#963e36;text-decoration:none;cursor:pointer;font:inherit}a{color:#d2b297}</style><main><small>MUSEFILM · KEEP THE LIGHT</small><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${action}<p><a href="https://musefilm.top/">回到 MuseFilm ↗</a></p></main></html>`;
}

function subscriberEmailHtml(title, paragraphs, action, footer, contentHtml = null) {
  return `<!doctype html><html lang="zh-CN"><body style="margin:0;padding:32px 16px;background:#090909;color:#f2efe8;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',Arial,sans-serif"><table role="presentation" style="width:100%;max-width:600px;margin:auto;border:1px solid #38322e;border-radius:22px;background:#151413;border-collapse:separate"><tr><td style="padding:32px"><div style="color:#d4b69a;font-size:12px;letter-spacing:.16em">MUSEFILM · A LETTER FROM THE DARKROOM</div><h1 style="font-size:32px;font-weight:600;line-height:1.3;letter-spacing:-.04em;color:#f2efe8">${escapeHtml(title)}</h1>${contentHtml ?? paragraphs.map(p => `<p style="color:#c4bfb7;font-size:15px;line-height:1.9;white-space:pre-wrap">${escapeHtml(p)}</p>`).join("")}${action}<hr style="border:0;border-top:1px solid #37312d;margin:28px 0"><div style="font-size:11px;color:#928b81;line-height:1.8">${footer}</div></td></tr></table></body></html>`;
}

function emailButton(url, label) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;margin:12px 0;padding:13px 22px;border:1px solid #d05248;border-radius:99px;background:#963e36;color:#fff;text-decoration:none;font-size:14px">${escapeHtml(label)} ↗</a>`;
}

function subscriberLinks(subscriber) {
  return { confirm: `${COMMUNITY_ORIGIN}/subscribe/confirm?token=${encodeURIComponent(subscriber.confirmation_token)}`, unsubscribe: `${COMMUNITY_ORIGIN}/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribe_token)}` };
}

function thankYouContent(subscriber) {
  const links = subscriberLinks(subscriber);
  const pending = subscriber.status === "pending";
  const feedbackUrl = "https://musefilm.top/?feedback=1#download";
  const paragraphs = ["谢谢你选择 MuseFilm。愿每一卷光，都有值得停留的位置。", "下载已经为你准备好。期待 MuseFilm 能陪你整理胶卷、扫描和那些不想遗忘的拍摄记忆。", "用起来顺手吗？有没有哪个地方让你停顿、困惑，或想要一个新的功能？直接回复这封邮件，或点下面的按钮告诉我。"];
  if (pending) paragraphs.push("你也勾选了接收版本更新与新闻。请点击「确认订阅」后再接收后续资讯；不确认不会被加入群发名单。");
  const action = emailButton(feedbackUrl, "告诉我你的使用感受") + (pending ? `<br>${emailButton(links.confirm, "确认订阅更新与新闻")}` : "");
  const footer = `此邮件因你在下载时自愿留下邮箱而发送。${pending ? "后续资讯仍需你确认订阅。" : subscriber.status === "subscribed" ? "你已订阅 MuseFilm 的版本更新与新闻，可随时退订。" : "不会因留下邮箱自动订阅新闻。"}<br><a href="${escapeHtml(links.unsubscribe)}" style="color:#bd9d85">不再接收邮件</a> · <a href="https://musefilm.top" style="color:#bd9d85">musefilm.top</a>`;
  return { subject: "感谢下载 MuseFilm，期待听见你的使用感受", html: subscriberEmailHtml("感谢你，让光继续留下。", paragraphs, action, footer), text: paragraphs.join("\n\n") + `\n\n反馈：${feedbackUrl}` + (pending ? `\n确认订阅：${links.confirm}` : "") + `\n不再接收邮件：${links.unsubscribe}` };
}

async function saveDownloadContact(env, body, event) {
  const email = cleanText(body.email, 160).toLowerCase();
  if (!email) return null;
  const now = event.created_at;
  const direct = body.consentVersion === DIRECT_CONSENT_VERSION;
  const requested = direct || body.subscribe === true && body.consentVersion === CONSENT_VERSION;
  await env.DB.prepare(`INSERT INTO subscribers(id,email,status,locale,platform,consent_version,consent_at,confirmed_at,confirmation_token,unsubscribe_token,created_at,last_download_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET
    locale=excluded.locale, platform=excluded.platform, last_download_at=excluded.last_download_at,
    status=CASE WHEN excluded.status='subscribed' THEN 'subscribed' WHEN excluded.status='pending' AND subscribers.status IN ('contact','unsubscribed') THEN 'pending' ELSE subscribers.status END,
    confirmation_token=CASE WHEN excluded.status='pending' AND subscribers.status='unsubscribed' THEN excluded.confirmation_token ELSE subscribers.confirmation_token END,
    consent_at=CASE WHEN excluded.status IN ('pending','subscribed') THEN excluded.consent_at ELSE subscribers.consent_at END,
    confirmed_at=CASE WHEN excluded.status='subscribed' THEN excluded.confirmed_at WHEN excluded.status='pending' AND subscribers.status='unsubscribed' THEN NULL ELSE subscribers.confirmed_at END,
    consent_version=CASE WHEN excluded.status IN ('pending','subscribed') THEN excluded.consent_version ELSE subscribers.consent_version END`)
    .bind(crypto.randomUUID(),email,direct ? "subscribed" : requested ? "pending" : "contact",event.locale || "zh",event.platform,requested ? body.consentVersion : "",requested ? now : null,direct ? now : null,crypto.randomUUID()+crypto.randomUUID(),crypto.randomUUID()+crypto.randomUUID(),now,now).run();
  const subscriber = await env.DB.prepare("SELECT * FROM subscribers WHERE email=?").bind(email).first();
  if (subscriber && ["windows","mac"].includes(event.platform)) await env.DB.prepare("INSERT OR IGNORE INTO subscriber_platforms(subscriber_id,platform,created_at) VALUES(?,?,?)").bind(subscriber.id,event.platform,now).run();
  if (subscriber) await env.DB.prepare("INSERT OR IGNORE INTO subscriber_downloads(download_id,subscriber_id) VALUES(?,?)").bind(event.id,subscriber.id).run();
  if (!subscriber || subscriber.status === "unsubscribed") return { subscriber, mailId: null };
  const id = crypto.randomUUID();
  const key = await sha256(subscriber.status === "pending" ? `subscription-confirm:${email}:${subscriber.confirmation_token}` : `thank-you:${email}:${now.slice(0,10)}`);
  const result = await env.DB.prepare("INSERT OR IGNORE INTO subscriber_mail_log(id,subscriber_id,kind,dedupe_key,status,created_at) VALUES(?,?,'thank_you',?,'queued',?)").bind(id,subscriber.id,key,now).run();
  return { subscriber, mailId: Number(result.meta?.changes || 0) ? id : null };
}

async function sendThankYou(env, contact) {
  if (!contact?.mailId) return;
  let status = "sent", errorCode = "";
  try {
    const subscriber = await env.DB.prepare("SELECT * FROM subscribers WHERE id=?").bind(contact.subscriber.id).first();
    const suppressed=subscriber && await env.DB.prepare("SELECT email FROM mail_suppressions WHERE email=?").bind(subscriber.email).first();
    if (!subscriber || subscriber.status === "unsubscribed" || suppressed) status = "suppressed";
    else await sendCommunityMail(env,{ to: subscriber.email, from: env.FEEDBACK_FROM_EMAIL, replyTo: env.FEEDBACK_TO_EMAIL, ...thankYouContent(subscriber) });
  } catch (error) { status = "failed"; errorCode = cleanText(error?.code || "send_failed", 80); }
  await env.DB.prepare("UPDATE subscriber_mail_log SET status=?,error_code=?,sent_at=? WHERE id=?").bind(status,errorCode,status === "sent" ? new Date().toISOString() : null,contact.mailId).run();
}

function cookieValue(request, name) {
  return String(request.headers.get("Cookie") || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length+1) || "";
}

async function hasAdminSession(request, env) {
  const token = cookieValue(request,"musefilm_admin");
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const row = await env.DB.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash=? AND expires_at>?").bind(await sha256(token),new Date().toISOString()).first();
  return Boolean(row?.expires_at);
}

async function requestAdminCode(request, env) {
  const fingerprint = await feedbackFingerprint(request,env);
  const now = new Date();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM admin_login_codes WHERE created_at>? AND (fingerprint=? OR created_at>?)").bind(new Date(now.getTime()-3600000).toISOString(),fingerprint,new Date(now.getTime()-60000).toISOString()).first();
  const global = await env.DB.prepare("SELECT COUNT(*) AS count FROM admin_login_codes WHERE created_at>?").bind(new Date(now.getTime()-3600000).toISOString()).first();
  if (Number(recent?.count || 0) >= 3 || Number(global?.count || 0) >= 10) return json({ok:false,error:"请稍后再试，验证码请求过于频繁。"},429);
  if (!downloadEmailConfigured(env)) return json({ok:false,error:"站长邮箱尚未配置。"},503);
  const id = crypto.randomUUID();
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000000).padStart(8,"0");
  const expires = new Date(now.getTime()+600000).toISOString();
  const hash = await sha256(`${id}:${code}:${fingerprintSalt(env)}`);
  await env.DB.prepare("INSERT INTO admin_login_codes(id,code_hash,fingerprint,created_at,expires_at) VALUES(?,?,?,?,?)").bind(id,hash,fingerprint,now.toISOString(),expires).run();
  try {
    await env.EMAIL.send({to:env.FEEDBACK_TO_EMAIL,from:env.FEEDBACK_FROM_EMAIL,subject:"[MuseFilm] 后台登录验证码",text:`你的 MuseFilm 后台登录验证码：${code}\n10 分钟内有效，只能使用一次。若非本人操作，请忽略。`,html:subscriberEmailHtml("回到你的暗房。",["你的 MuseFilm 后台登录验证码：",code,"10 分钟内有效，只能使用一次。若非本人操作，请忽略。"],"", "此验证码仅用于站长后台登录，请勿转发。")});
  } catch { await env.DB.prepare("DELETE FROM admin_login_codes WHERE id=?").bind(id).run(); return json({ok:false,error:"验证码暂未发出，请稍后重试。"},503); }
  return json({ok:true,challengeId:id},200,{"Set-Cookie":`musefilm_challenge=${id}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=600`});
}

async function loginAdmin(request,env) {
  const body = await readJson(request,2048);
  const id = cleanText(body.challengeId,100);
  if (!id || cookieValue(request,"musefilm_challenge") !== id || !/^\d{8}$/.test(String(body.code || ""))) return json({ok:false,error:"验证码无效或已过期。"},401);
  const now = new Date().toISOString();
  const row = await env.DB.prepare("UPDATE admin_login_codes SET attempts=attempts+1 WHERE id=? AND attempts<5 AND used_at IS NULL AND expires_at>? RETURNING code_hash").bind(id,now).first();
  const candidate = await sha256(`${id}:${body.code}:${fingerprintSalt(env)}`);
  if (!row || !(await secureEqual(row.code_hash,candidate))) return json({ok:false,error:"验证码无效或已过期。"},401);
  const claimed = await env.DB.prepare("UPDATE admin_login_codes SET used_at=? WHERE id=? AND used_at IS NULL").bind(now,id).run();
  if (!Number(claimed.meta?.changes || 0)) return json({ok:false,error:"验证码已使用。"},401);
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,"0")).join("");
  await env.DB.prepare("INSERT INTO admin_sessions(token_hash,created_at,expires_at) VALUES(?,?,?)").bind(await sha256(token),now,new Date(Date.now()+12*3600000).toISOString()).run();
  return json({ok:true},200,{"Set-Cookie":`musefilm_admin=${token}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`});
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}

function campaignContent(campaign,subscriber) {
  const unsubscribe = subscriberLinks(subscriber).unsubscribe;
  const content=campaignBodyContent(campaign.body),target=campaign.release_url || "https://musefilm.top/#download";
  return { subject:campaign.subject,emailImages:content.images,html:subscriberEmailHtml(campaign.subject,[],emailButton(target,campaign.kind==="followup" ? "告诉我使用感受" : campaign.kind==="release" ? "查看新版本与下载" : "打开 MuseFilm"),`你已订阅 MuseFilm 的版本更新与新闻。<br><a href="${escapeHtml(unsubscribe)}" style="color:#bd9d85">退订后续邮件</a> · musefilm.top`,content.html),text:campaign.subject+"\n\n"+content.text+`\n\n${campaign.kind==="followup"?"反馈：":"下载："}${target}\n退订：${unsubscribe}` };
}

async function campaignProgress(env,id) {
  const rows = await env.DB.prepare("SELECT status,COUNT(*) AS count FROM campaign_recipients WHERE campaign_id=? GROUP BY status").bind(id).all();
  const progress = {pending:0,sending:0,sent:0,failed:0,skipped:0};
  for (const row of rows.results || []) progress[row.status]=Number(row.count);
  return progress;
}

async function handleCommunity(request,env,ctx) {
  const releaseResponse=await handleReleaseCheck(request,env,ctx);if(releaseResponse)return releaseResponse;
  const url = new URL(request.url),path=url.pathname;
  if (path === "/admin" || path === "/admin/") return communityHtml(ADMIN_PAGE_HTML,"MuseFilm",true);
  if (["/subscribe/confirm","/unsubscribe"].includes(path)) {
    const token=cleanText(url.searchParams.get("token"),100),confirm=path==="/subscribe/confirm";
    const row=await env.DB.prepare(`SELECT id,status FROM subscribers WHERE ${confirm ? "confirmation_token" : "unsubscribe_token"}=?`).bind(token).first();
    if(!row) return communityHtml(communityMessage("这封来信的链接已失效。","你仍可以在下载时重新选择是否留下邮箱。"));
    const action=`<form action="${confirm ? "/api/subscribe/confirm" : "/api/unsubscribe"}" method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button>${confirm ? "确认订阅更新与新闻" : "确认退订"}</button></form>`;
    return communityHtml(communityMessage(confirm ? "让下一卷消息，抵达你。" : "让收件箱安静一点。",confirm ? "确认后，你将收到 MuseFilm 的版本更新与新闻。随时可以通过邮件底部的链接退订。" : "退订不会影响你下载或使用 MuseFilm。",action));
  }
  if (["/api/subscribe/confirm","/api/unsubscribe"].includes(path) && request.method === "POST") {
    if(request.headers.get("Origin") !== url.origin) return json({ok:false,error:"origin_not_allowed"},403);
    const form=await request.formData(),token=cleanText(form.get("token"),100),confirm=path.endsWith("/confirm");
    const result=confirm
      ? await env.DB.prepare("UPDATE subscribers SET status='subscribed',confirmed_at=? WHERE confirmation_token=? AND status='pending'").bind(new Date().toISOString(),token).run()
      : await env.DB.prepare("UPDATE subscribers SET status='unsubscribed' WHERE unsubscribe_token=?").bind(token).run();
    return communityHtml(communityMessage(Number(result.meta?.changes || 0) ? (confirm ? "订阅已确认。" : "已经为你退订。") : "状态没有改变。",confirm ? "后续的 MuseFilm 更新与新闻，会在准备好时寄给你。" : "我们不会再向这个地址发送后续邮件。"));
  }
  if (!path.startsWith("/api/admin/")) return null;
  if (!["GET","HEAD"].includes(request.method) && request.headers.get("Origin") !== url.origin) return json({ok:false,error:"origin_not_allowed"},403);
  if (path === "/api/admin/login/request" && request.method === "POST") return requestAdminCode(request,env);
  if (path === "/api/admin/login" && request.method === "POST") return loginAdmin(request,env);
  if (!(await adminAuthorized(request,env))) return json({ok:false,error:"unauthorized"},401);
  const membershipResponse=await membershipAdmin(request,env);if(membershipResponse)return membershipResponse;
  const dashboardResponse=await handleDashboardAdmin(request,env);if(dashboardResponse)return dashboardResponse;
  if (path === "/api/admin/session") return json({ok:true});
  if (path === "/api/admin/mail-config") return json({ok:true,ready:communityMailReady(env),ownerEmail:validEmail(env.FEEDBACK_TO_EMAIL) ? env.FEEDBACK_TO_EMAIL : "",provider:env.SMTP_PASSWORD ? "qq_smtp" : env.SUBSCRIBER_EMAIL ? "cloudflare" : "not_configured"});
  if (path === "/api/admin/logout" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha256(cookieValue(request,"musefilm_admin"))).run();
    return json({ok:true},200,{"Set-Cookie":"musefilm_admin=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0"});
  }
  if (path === "/api/admin/subscribers" && request.method === "GET") return dashboardSubscribers(request,env);
  if (path === "/api/admin/export" && request.method === "GET") return dashboardExport(request,env);
  const subscriberMatch=path.match(/^\/api\/admin\/subscribers\/([^/]+)$/);
  if(subscriberMatch && request.method === "PATCH") {
    const body=await readJson(request,1024);
    if(body.action!=="unsubscribe") return json({ok:false,error:"invalid_action"},400);
    await env.DB.prepare("UPDATE subscribers SET status='unsubscribed' WHERE id=?").bind(subscriberMatch[1]).run();
    return json({ok:true});
  }
  const workflowsResponse=await handleWorkflowsAdmin(request,env);if(workflowsResponse)return workflowsResponse;
  return handleMailAdmin(request,env,ctx);
}

// Embedded with community.js. All times are UTC ISO strings; the admin converts local input.
const RELEASE_FEED = "https://api.github.com/repos/Quartzsyr/MuseFilm/releases?per_page=100";
const RELEASE_SNAPSHOT = "https://raw.githubusercontent.com/Quartzsyr/MuseFilm/main/releases.json";
const RELEASE_AUDIENCE = COMMUNITY_ORIGIN + "/api/releases/check";
const RETRY_DELAYS = [5*60000,30*60000,2*3600000];
const isoNow = () => new Date().toISOString();
const campaignSelect = "SELECT c.*,COALESCE(o.audience,'all') AS audience,COALESCE(o.kind,'manual') AS kind,o.scheduled_at,o.source_key,COALESCE(o.release_url,'') AS release_url FROM campaigns c LEFT JOIN campaign_options o ON o.campaign_id=c.id";
const audienceWhere = "s.status='subscribed' AND NOT EXISTS(SELECT 1 FROM mail_suppressions x WHERE x.email=s.email) AND (?='all' OR EXISTS(SELECT 1 FROM subscriber_platforms p WHERE p.subscriber_id=s.id AND p.platform=?))";

async function mailLock(env,name,seconds=90) {
  const token=crypto.randomUUID(),now=isoNow(),until=new Date(Date.now()+seconds*1000).toISOString();
  const result=await env.DB.prepare("INSERT INTO mail_locks(name,token,until_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET token=excluded.token,until_at=excluded.until_at WHERE mail_locks.until_at<?").bind(name,token,until,now).run();
  return Number(result.meta?.changes) ? async()=>env.DB.prepare("DELETE FROM mail_locks WHERE name=? AND token=?").bind(name,token).run() : null;
}
async function recipientCount(env,audience) {
  return Number((await env.DB.prepare(`SELECT COUNT(*) AS count FROM subscribers s WHERE ${audienceWhere}`).bind(audience,audience).first())?.count || 0);
}
async function snapshotRecipients(env,id,audience) {
  await env.DB.prepare(`INSERT OR IGNORE INTO campaign_recipients(campaign_id,subscriber_id) SELECT ?,s.id FROM subscribers s WHERE ${audienceWhere}`).bind(id,audience,audience).run();
}
function deliveryClass(error,attempt) {
  const code=String(error?.code || 'SMTP_UNKNOWN'),stage=String(error?.stage || 'unknown'),numeric=Number(code.match(/^SMTP_(\d{3})$/)?.[1] || 0);
  if(error?.uncertain || stage==='data_ack' && !numeric) return {status:'uncertain',safe:false};
  if(stage==='rcpt' && numeric>=500 && /^5\.(?:1\.|2\.1$)/.test(error?.enhanced || '')) return {status:'bounced',safe:false};
  // Configuration/authentication errors never suppress an individual recipient.
  const temporary=numeric>=400 && numeric<500 || ['SMTP_CONNECTION_FAILED','SMTP_CONNECTION_CLOSED','SMTP_TIMEOUT'].includes(code) && stage!=='unknown';
  if(temporary) return {status:attempt<=RETRY_DELAYS.length?'retry_wait':'failed',safe:true};
  return {status:'failed',safe:['auth','connect','ehlo','mail','rcpt'].includes(stage) && numeric!==0};
}
async function recordBounce(env,{campaignId,subscriberId,email,kind,diagnostic,source,key}) {
  const now=isoNow(),id=crypto.randomUUID();
  const statements=[env.DB.prepare("INSERT OR IGNORE INTO mail_bounces(id,dedupe_key,campaign_id,subscriber_id,email,kind,diagnostic,source,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,key,campaignId,subscriberId,email,kind,cleanText(diagnostic,300),source,now)];
  if(kind==='hard') {
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO mail_suppressions(email,reason,source,created_at) VALUES(?,'hard_bounce',?,?)").bind(email,source,now));
    statements.push(env.DB.prepare("UPDATE campaign_recipients SET status='bounced',error_code='DSN_HARD_BOUNCE' WHERE campaign_id=? AND subscriber_id=? AND status IN ('sent','uncertain','bounced')").bind(campaignId,subscriberId));
  }
  await env.DB.batch(statements);
}
async function settleCampaign(env,id) {
  const p=await campaignProgress(env,id);
  const active=p.pending || p.sending || p.retry_wait;
  if(!active) await env.DB.prepare("UPDATE campaigns SET status=?,updated_at=? WHERE id=? AND status IN ('sending','queued','retry_wait','sent')").bind(p.failed || p.bounced || p.uncertain ? 'partial_failure':p.sent?'sent':'cancelled',isoNow(),id).run();
  return p;
}
async function dispatchCampaign(env,campaign,limit=2) {
  const now=isoNow();
  if(!['sending','queued','retry_wait'].includes(campaign.status) || campaign.scheduled_at && campaign.scheduled_at>now) return campaignProgress(env,campaign.id);
  await env.DB.prepare("UPDATE campaigns SET status='sending',updated_at=? WHERE id=? AND status IN ('queued','retry_wait')").bind(now,campaign.id).run();
  const rows=await env.DB.prepare("SELECT r.subscriber_id,d.attempts FROM campaign_recipients r LEFT JOIN mail_delivery d ON d.campaign_id=r.campaign_id AND d.subscriber_id=r.subscriber_id WHERE r.campaign_id=? AND r.status IN ('pending','retry_wait') AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=?) AND (d.lease_token IS NULL) ORDER BY r.subscriber_id LIMIT ?").bind(campaign.id,now,limit).all();
  await Promise.all((rows.results || []).map(async row=>{
    const messageId=`mf-${await sha256(campaign.id+':'+row.subscriber_id)}@musefilm.top`;
    await env.DB.prepare("INSERT OR IGNORE INTO mail_delivery(campaign_id,subscriber_id,message_id) VALUES(?,?,?)").bind(campaign.id,row.subscriber_id,messageId).run();
    const lease=crypto.randomUUID(),until=new Date(Date.now()+90000).toISOString();
    const claimed=await env.DB.prepare("UPDATE mail_delivery SET lease_token=?,lease_until=?,attempts=attempts+1 WHERE campaign_id=? AND subscriber_id=? AND lease_token IS NULL AND next_attempt_at<=? AND EXISTS(SELECT 1 FROM campaign_recipients r WHERE r.campaign_id=mail_delivery.campaign_id AND r.subscriber_id=mail_delivery.subscriber_id AND r.status IN ('pending','retry_wait')) RETURNING attempts").bind(lease,until,campaign.id,row.subscriber_id,now).first();
    if(!claimed) return;
    await env.DB.prepare("UPDATE campaign_recipients SET status='sending' WHERE campaign_id=? AND subscriber_id=? AND status IN ('pending','retry_wait')").bind(campaign.id,row.subscriber_id).run();
    const subscriber=await env.DB.prepare("SELECT s.* FROM subscribers s WHERE s.id=? AND s.status='subscribed' AND NOT EXISTS(SELECT 1 FROM mail_suppressions x WHERE x.email=s.email)").bind(row.subscriber_id).first();
    let status='skipped',code='',stage='',safe=false,next='';
    if(subscriber && (campaign.kind!=='followup' || await followupAllowed(env,subscriber.id))) {
      try {
        await sendCommunityMail(env,{to:subscriber.email,from:env.FEEDBACK_FROM_EMAIL,replyTo:env.FEEDBACK_TO_EMAIL,...campaignContent(campaign,subscriber),messageId});
        status='sent';stage='accepted';
      } catch(error) {
        code=cleanText(error?.code || 'SMTP_UNKNOWN',80);stage=cleanText(error?.stage || 'unknown',40);
        const result=deliveryClass(error,claimed.attempts);status=result.status;safe=result.safe;
        if(status==='retry_wait') next=new Date(Date.now()+RETRY_DELAYS[claimed.attempts-1]).toISOString();
        if(status==='bounced') await recordBounce(env,{campaignId:campaign.id,subscriberId:subscriber.id,email:subscriber.email,kind:'hard',diagnostic:code,source:'smtp_rcpt',key:`smtp:${campaign.id}:${subscriber.id}`});
      }
    }
    // A crash after SMTP acceptance leaves a lease. Expiry becomes uncertain, never an automatic resend.
    await env.DB.batch([
      env.DB.prepare("UPDATE campaign_recipients SET status=?,error_code=?,sent_at=? WHERE campaign_id=? AND subscriber_id=?").bind(status,code,status==='sent'?isoNow():null,campaign.id,row.subscriber_id),
      env.DB.prepare("UPDATE mail_delivery SET lease_token=NULL,lease_until=NULL,next_attempt_at=?,last_stage=?,retry_safe=? WHERE campaign_id=? AND subscriber_id=? AND lease_token=?").bind(next,stage,safe?1:0,campaign.id,row.subscriber_id,lease),
      env.DB.prepare("INSERT INTO mail_attempts(id,campaign_id,subscriber_id,attempt,status,error_code,stage,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),campaign.id,row.subscriber_id,claimed.attempts,status,code,stage,isoNow())
    ]);
  }));
  return settleCampaign(env,campaign.id);
}
async function dispatchMail(env) {
  if(!communityMailReady(env)) return;
  const release=await mailLock(env,'dispatch',75);if(!release)return;
  try {
    await env.DB.prepare("UPDATE campaign_recipients SET status='uncertain',error_code='SEND_LEASE_EXPIRED' WHERE status IN ('sending','pending','retry_wait') AND EXISTS(SELECT 1 FROM mail_delivery d WHERE d.campaign_id=campaign_recipients.campaign_id AND d.subscriber_id=campaign_recipients.subscriber_id AND d.lease_token IS NOT NULL AND d.lease_until<?)").bind(isoNow()).run();
    const rows=await env.DB.prepare(campaignSelect+" WHERE c.status IN ('scheduled','queued','sending','retry_wait') AND (o.scheduled_at IS NULL OR o.scheduled_at<=?) AND (EXISTS(SELECT 1 FROM campaign_recipients r LEFT JOIN mail_delivery d ON d.campaign_id=r.campaign_id AND d.subscriber_id=r.subscriber_id WHERE r.campaign_id=c.id AND (r.status='pending' OR r.status='retry_wait' AND d.next_attempt_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))) OR NOT EXISTS(SELECT 1 FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status IN ('pending','sending','retry_wait'))) ORDER BY COALESCE(o.scheduled_at,c.created_at) LIMIT 1").bind(isoNow()).all();
    for(const campaign of rows.results || []) {
      if(campaign.status==='scheduled') {
        await env.DB.prepare("UPDATE campaigns SET status='queued' WHERE id=? AND status='scheduled'").bind(campaign.id).run();campaign.status='queued';
      }
      await dispatchCampaign(env,campaign);
    }
  } finally {await release()}
}

function checkedReleaseList(releases) {
  if(!Array.isArray(releases) || !releases.length || releases.length>1000 || releases.some(r=>!r || !Number.isSafeInteger(r.id) || r.id<=0 || typeof r.tag_name!=='string' || !r.tag_name || !Array.isArray(r.assets) || !r.draft && !Number.isFinite(Date.parse(r.published_at))))throw Object.assign(new Error('Invalid release feed'),{code:'GITHUB_BAD_FEED'});
  return releases;
}
function checkedReleaseSnapshot(snapshot,maxAge=3*3600000) {
  const generated=Date.parse(snapshot?.updatedAt);
  if(snapshot?.schemaVersion!==1 || snapshot.repository!=='Quartzsyr/MuseFilm')throw Object.assign(new Error('Invalid release snapshot'),{code:'RELEASE_SNAPSHOT_INVALID'});
  if(!Number.isFinite(generated) || generated>Date.now()+5*60000 || Date.now()-generated>maxAge)throw Object.assign(new Error('Release snapshot is stale'),{code:'RELEASE_SNAPSHOT_STALE'});
  return checkedReleaseList(snapshot.releases);
}
async function releaseFeed(settings,fetcher) {
  let primaryError;
  try {
    const response=await fetcher(RELEASE_FEED,{headers:{'User-Agent':'MuseFilm-release-mail','Accept':'application/vnd.github+json',...(settings.etag?{'If-None-Match':settings.etag}:{})},signal:AbortSignal.timeout(8000)});
    if(response.status===304 && settings.baseline_at)return {unchanged:true,source:'github_api'};
    if(!response.ok)throw Object.assign(new Error('Release source unavailable'),{code:'GITHUB_'+response.status});
    return {releases:checkedReleaseList(await readJson(response,2000000)),etag:cleanText(response.headers.get('ETag'),160),source:'github_api'};
  } catch(error) {primaryError=error}
  // The snapshot is generated by authenticated GitHub Actions in this repository.
  // Never reuse the API ETag for this different resource, or accept a stale/legacy snapshot.
  const response=await fetcher(RELEASE_SNAPSHOT,{headers:{'Accept':'application/json'},cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw primaryError;
  return {releases:checkedReleaseSnapshot(await readJson(response,2000000)),etag:'',source:'github_snapshot'};
}

function releaseVariants(releases,includePrerelease) {
  const result=[];
  for(const release of releases) {
    if(release.draft || release.prerelease && !includePrerelease || !Number.isSafeInteger(release.id) || !Number.isFinite(Date.parse(release.published_at)))continue;
    const platforms=new Set();
    for(const asset of release.assets || []) {const info=installerInfo(asset.browser_download_url);if(info && asset.state!=='starter')platforms.add(info.platform)}
    const releaseUrl=`https://github.com/Quartzsyr/MuseFilm/releases/tag/${encodeURIComponent(String(release.tag_name || ''))}`;
    for(const platform of platforms)result.push({key:`${release.id}:${platform}:${release.prerelease?'preview':'stable'}`,platform,published:release.published_at,url:releaseUrl,
      title:cleanText(release.name || release.tag_name,120),notes:cleanText(release.body || '本次更新已经准备好，欢迎下载体验。',10000),preview:Boolean(release.prerelease)});
  }
  return result;
}
async function scanReleases(env,force=false,fetcher=fetch,pushedSnapshot=null) {
  const release=await mailLock(env,'release-scan');if(!release)return {busy:true};
  try {
    const settings=await env.DB.prepare("SELECT * FROM mail_settings WHERE id=1").first();
    if(!force && settings.scan_due>isoNow())return {skipped:true};
    const feed=pushedSnapshot?{releases:checkedReleaseSnapshot(pushedSnapshot,10*60000),etag:'',source:'github_actions'}:await releaseFeed(settings,fetcher);
    const now=isoNow(),due=new Date(Date.now()+5*60000).toISOString();
    if(feed.unchanged) {
      await env.DB.prepare("UPDATE mail_settings SET last_scan_at=?,scan_due=?,scan_error='' WHERE id=1").bind(now,due).run();return {unchanged:true,source:feed.source};
    }
    const releases=feed.releases;
    // Record all preview/stable variants even when preview mail is disabled, so toggling it never backfills old mail.
    const variants=releaseVariants(releases,true),existing=await env.DB.prepare("SELECT source_key FROM mail_releases").all(),seen=new Set((existing.results||[]).map(r=>r.source_key));
    const workflow=await env.DB.prepare('SELECT release_mode FROM workflow_settings WHERE id=1').first(),review=workflow?.release_mode!=='auto';
    let created=0;const statements=[];
    for(const item of variants) {
      if(seen.has(item.key))continue;
      const shouldSend=Boolean(settings.baseline_at && settings.enabled && (!item.preview || settings.include_prerelease) && (Date.parse(item.published)>=Date.parse(settings.baseline_at) || !item.preview && seen.has(item.key.replace(':stable',':preview'))));
      const id=shouldSend?crypto.randomUUID():'';
      // A single D1 transaction creates the dedupe marker, campaign and audience snapshot.
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO mail_releases(source_key,campaign_id,discovered_at) VALUES(?,?,?)").bind(item.key,id,now));
      if(!shouldSend)continue;
      const label=item.platform==='mac'?'macOS':'Windows',subject=`MuseFilm ${label} ${item.title}${item.preview?' · 预览版':''} 已发布`;
      const body=releaseDraftBody(item);
      statements.push(env.DB.prepare("INSERT INTO campaigns(id,subject,body,status,test_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id,subject,body,review?'draft':'queued',review?'':'automatic',now,now));
      statements.push(env.DB.prepare("INSERT INTO campaign_options(campaign_id,audience,kind,scheduled_at,source_key,release_url) VALUES(?,?,'release',?,?,?)").bind(id,item.platform,now,item.key,item.url));
      if(!review)statements.push(env.DB.prepare(`INSERT INTO campaign_recipients(campaign_id,subscriber_id) SELECT ?,s.id FROM subscribers s WHERE ${audienceWhere}`).bind(id,item.platform,item.platform));created++;
    }
    statements.push(env.DB.prepare("UPDATE mail_settings SET baseline_at=COALESCE(baseline_at,?),last_scan_at=?,scan_due=?,scan_error='',etag=? WHERE id=1").bind(now,now,due,feed.etag));
    // Bound the transaction even when an authenticated paginated feed includes more history.
    if(statements.length>450)throw Object.assign(new Error('Too many new releases'),{code:'RELEASE_BATCH_TOO_LARGE'});
    await env.DB.batch(statements);
    return {baseline:!settings.baseline_at,created,source:feed.source};
  } catch(error) {
    const code=cleanText(error?.code || 'RELEASE_SCAN_FAILED',80);
    await env.DB.prepare("UPDATE mail_settings SET scan_error=?,scan_due=? WHERE id=1").bind(code,new Date(Date.now()+5*60000).toISOString()).run();
    return {error:code};
  } finally {await release()}
}

let githubJwksCache;
async function verifyReleaseToken(token,fetcher=fetch) {
  if(typeof token!=='string' || token.length>16000)throw new Error('INVALID_RELEASE_TOKEN');
  const parts=token.split('.');if(parts.length!==3)throw new Error('INVALID_RELEASE_TOKEN');
  const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1]))),now=Date.now()/1000;
  if(header.alg!=='RS256' || !header.kid || claims.iss!=='https://token.actions.githubusercontent.com' || ![RELEASE_AUDIENCE,'https://musefilm-feedback-api.syrquartz.workers.dev/api/releases/check'].includes(claims.aud) || !Number.isFinite(claims.exp) || claims.exp<now || !Number.isFinite(claims.iat) || claims.iat>now+30 || now-claims.iat>600 || !Number.isFinite(claims.nbf) || claims.nbf>now+30 || String(claims.repository_id)!=='1158598100' || claims.repository!=='Quartzsyr/MuseFilm' || !['release','workflow_dispatch','schedule'].includes(claims.event_name) || !/^Quartzsyr\/MuseFilm\/\.github\/workflows\/notify-release-subscribers\.yml@refs\/(heads\/main|tags\/.+)$/.test(claims.workflow_ref || ''))throw new Error('INVALID_RELEASE_TOKEN');
  if(!githubJwksCache || githubJwksCache.expires<Date.now() || !githubJwksCache.keys.some(k=>k.kid===header.kid)) {
    const response=await fetcher('https://token.actions.githubusercontent.com/.well-known/jwks',{signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('OIDC_KEYS_UNAVAILABLE');const data=await response.json();githubJwksCache={keys:data.keys || [],expires:Date.now()+3600000};
  }
  const jwk=githubJwksCache.keys.find(k=>k.kid===header.kid && k.kty==='RSA');if(!jwk)throw new Error('INVALID_RELEASE_TOKEN');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw new Error('INVALID_RELEASE_TOKEN');
  return claims;
}

function mimeHeaders(text) {
  const result={};for(const line of text.replace(/\r?\n[ \t]+/g,' ').split(/\r?\n/)) {const m=line.match(/^([a-z0-9-]+):\s*(.*)$/i);if(m)result[m[1].toLowerCase()]=m[2]}
  return result;
}
function parseBounceReport(raw) {
  if(typeof raw!=='string' || raw.length>196608)return [];
  const reports=[],messageIds=new Set();
  const walk=(text,depth=0)=>{
    if(depth>6)return;const divider=text.search(/\r?\n\r?\n/);if(divider<0)return;
    const headers=mimeHeaders(text.slice(0,divider)),body=text.slice(divider).replace(/^\r?\n\r?\n/,'');
    const type=headers['content-type'] || '',transfer=headers['content-transfer-encoding'] || '';
    let decoded=body;
    try {if(/^base64$/i.test(transfer))decoded=new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\s/g,'')),c=>c.charCodeAt(0)));else if(/^quoted-printable$/i.test(transfer))decoded=body.replace(/=\r?\n/g,'').replace(/=([a-f0-9]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)))}catch{return}
    if(/^multipart\//i.test(type)) {
      const boundary=type.match(/boundary\s*=\s*(?:"([^"\r\n]+)"|([^;\s]+))/i),value=boundary?.[1] || boundary?.[2];
      if(value && value.length<150)for(const part of decoded.split('--'+value).slice(1,20))if(!part.startsWith('--'))walk(part.replace(/^\r?\n/,''),depth+1);
    } else if(/^message\/(?:global-)?delivery-status\b/i.test(type))reports.push(decoded);
    else if(/^message\/rfc822\b|^text\/rfc822-headers\b/i.test(type)) {
      const original=mimeHeaders(decoded.split(/\r?\n\r?\n/)[0]);
      for(const name of ['message-id','original-message-id','x-musefilm-message-id']) {const m=original[name]?.match(/<?(mf-[a-f0-9]{64}@musefilm\.top)>?/);if(m)messageIds.add(m[1])}
    }
    const originalId=headers['original-message-id']?.match(/<?(mf-[a-f0-9]{64}@musefilm\.top)>?/);if(originalId)messageIds.add(originalId[1]);
  };
  walk(raw);if(!reports.length || messageIds.size!==1)return [];
  const messageId=[...messageIds][0],result=[];
  for(const report of reports)for(const block of report.split(/\r?\n\r?\n/)) {
    const h=mimeHeaders(block),email=(h['original-recipient'] || h['final-recipient'] || '').replace(/^[^;]*;\s*/,'').replace(/[<>]/g,'').trim().toLowerCase();
    const action=(h.action || '').toLowerCase(),status=h.status || '';
    if(!validEmail(email) || !['failed','delayed'].includes(action) || !/^[245]\.\d{1,3}\.\d{1,3}$/.test(status))continue;
    result.push({messageId,email,kind:action==='failed'?'hard':'soft',diagnostic:status+' '+cleanText(h['diagnostic-code'],240)});
  }
  return result;
}
async function applyBounceReport(env,raw,sourceKey) {
  let matched=0;
  for(const report of parseBounceReport(raw)) {
    const delivery=await env.DB.prepare("SELECT d.campaign_id,d.subscriber_id,r.status FROM mail_delivery d JOIN campaign_recipients r ON r.campaign_id=d.campaign_id AND r.subscriber_id=d.subscriber_id JOIN subscribers s ON s.id=d.subscriber_id WHERE d.message_id=? AND s.email=? AND r.status IN ('sent','uncertain','bounced')").bind(report.messageId,report.email).first();
    if(!delivery)continue;
    await recordBounce(env,{campaignId:delivery.campaign_id,subscriberId:delivery.subscriber_id,email:report.email,kind:report.kind,diagnostic:report.diagnostic,source:'qq_imap',key:`${sourceKey}:${report.messageId}:${report.email}:${report.kind}`});
    await settleCampaign(env,delivery.campaign_id);matched++;
  }
  return matched;
}

async function qqImapReports(env,{uidvalidity='',cursor=0}={},connectOverride) {
  const user=env.SMTP_USER || env.FEEDBACK_TO_EMAIL,password=env.SMTP_PASSWORD;
  if(!validEmail(user) || !password)throw Object.assign(new Error('IMAP not configured'),{code:'IMAP_NOT_CONFIGURED'});
  const quote=value=>'"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
  if(/[\r\n\0]/.test(user+password))throw Object.assign(new Error('Invalid IMAP credentials'),{code:'IMAP_INVALID_CREDENTIAL'});
  const {Buffer}=await import('node:buffer'),connect=connectOverride || (await import('node:tls')).connect;
  const socket=connect({host:'imap.qq.com',port:993,servername:'imap.qq.com',rejectUnauthorized:true});
  let buffer=Buffer.alloc(0),literalLeft=0,literalChunks=[],lines=[],literals=[],pending=null,failed=null,tagNumber=0,greeted=false;
  const fail=code=>{failed=Object.assign(new Error(code),{code});if(pending){pending.reject(failed);pending=null}};
  socket.on('error',()=>fail('IMAP_CONNECTION_FAILED'));socket.on('close',()=>fail('IMAP_CONNECTION_CLOSED'));
  socket.setTimeout(12000,()=>{fail('IMAP_TIMEOUT');socket.destroy()});
  const deadline=setTimeout(()=>{fail('IMAP_TIMEOUT');socket.destroy()},22000);
  socket.on('data',chunk=>{
    buffer=Buffer.concat([buffer,Buffer.from(chunk)]);if(buffer.length>262144){fail('IMAP_RESPONSE_TOO_LARGE');socket.destroy();return}
    while(buffer.length) {
      if(literalLeft) {
        const size=Math.min(literalLeft,buffer.length);literalChunks.push(buffer.subarray(0,size));buffer=buffer.subarray(size);literalLeft-=size;
        if(!literalLeft){literals.push(Buffer.concat(literalChunks).toString('utf8'));literalChunks=[]}else return;
      } else {
        const end=buffer.indexOf('\r\n');if(end<0)return;
        const line=buffer.subarray(0,end).toString('utf8');buffer=buffer.subarray(end+2);
        if(!greeted) {greeted=true;if(!/^\* (OK|PREAUTH)\b/i.test(line)){fail('IMAP_BAD_GREETING');return}if(pending?.greeting){const p=pending;pending=null;p.resolve({lines:[line],literals:[]})}continue}
        lines.push(line);if(lines.length>4000){fail('IMAP_RESPONSE_TOO_LARGE');return}
        const size=line.match(/\{(\d+)\}$/);if(size){literalLeft=Number(size[1]);if(literalLeft>131072){fail('IMAP_LITERAL_TOO_LARGE');socket.destroy();return}}
        if(pending && line.startsWith(pending.tag+' ')) {
          const p=pending;pending=null;
          if(!new RegExp('^'+p.tag+' OK\\b','i').test(line))p.reject(Object.assign(new Error('IMAP command rejected'),{code:p.stage==='login'?'IMAP_AUTH_REJECTED':'IMAP_COMMAND_REJECTED'}));
          else p.resolve({lines,literals});lines=[];literals=[];
        }
      }
    }
  });
  const command=(text,stage)=>failed?Promise.reject(failed):new Promise((resolve,reject)=>{const tag='M'+(++tagNumber);pending={tag,stage,resolve,reject};lines=[];literals=[];socket.write(tag+' '+text+'\r\n',error=>{if(error)fail('IMAP_CONNECTION_FAILED')})});
  try {
    if(!greeted)await new Promise((resolve,reject)=>pending={greeting:true,resolve,reject});
    await command('LOGIN '+quote(user)+' '+quote(password),'login');
    // QQ requires an IMAP client identity on some accounts; ID is optional elsewhere.
    try {await command('ID ("name" "MuseFilm" "version" "1.0" "vendor" "MuseFilm" "contact" '+quote(user)+')','id')}catch(error){if(error.code!=='IMAP_COMMAND_REJECTED')throw error}
    const selected=await command('EXAMINE INBOX','examine'),combined=selected.lines.join('\n');
    const validity=combined.match(/\[UIDVALIDITY (\d+)\]/i)?.[1],uidnext=Number(combined.match(/\[UIDNEXT (\d+)\]/i)?.[1] || 1);
    if(!validity)throw Object.assign(new Error('Missing UIDVALIDITY'),{code:'IMAP_BAD_UIDVALIDITY'});
    const after=validity===uidvalidity?Number(cursor):0,date=new Date(Date.now()-30*86400000),since=`${date.getUTCDate()}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getUTCMonth()]}-${date.getUTCFullYear()}`;
    const searched=await command(`UID SEARCH UID ${after+1}:* SINCE ${since} OR HEADER Content-Type "report" OR HEADER From "mailer-daemon" HEADER From "postmaster"`,'search');
    const ids=searched.lines.filter(l=>/^\* SEARCH(?: |$)/i.test(l)).flatMap(l=>l.replace(/^\* SEARCH\s*/i,'').trim().split(/\s+/).map(Number)).filter(n=>Number.isSafeInteger(n)&&n>after).sort((a,b)=>a-b);
    const reports=[];let nextCursor=after;
    for(const uid of ids.slice(0,3)) {
      const fetched=await command(`UID FETCH ${uid} (BODY.PEEK[]<0.131072>)`,'fetch');
      for(const raw of fetched.literals)reports.push({key:`${validity}:${uid}`,raw});nextCursor=uid;
    }
    if(ids.length<=3)nextCursor=Math.max(nextCursor,uidnext-1);
    socket.write('M999 LOGOUT\r\n');return {uidvalidity:validity,cursor:nextCursor,reports};
  } finally {clearTimeout(deadline);socket.end();socket.destroy()}
}
async function pollBounces(env,force=false,reader=qqImapReports) {
  const release=await mailLock(env,'imap',60);if(!release)return {busy:true};
  try {
    const s=await env.DB.prepare('SELECT * FROM mail_settings WHERE id=1').first();if(!force && (!s.imap_enabled || s.imap_due>isoNow()))return {skipped:true};
    const result=await reader(env,{uidvalidity:s.imap_uidvalidity,cursor:s.imap_cursor});let matched=0;
    for(const message of result.reports) {
      const seen=await env.DB.prepare('SELECT mail_key FROM mail_imap_seen WHERE mail_key=?').bind(message.key).first();if(seen)continue;
      const count=await applyBounceReport(env,message.raw,message.key);matched+=count;
      await env.DB.prepare('INSERT OR IGNORE INTO mail_imap_seen(mail_key,processed_at,matched) VALUES(?,?,?)').bind(message.key,isoNow(),count).run();
    }
    await env.DB.prepare("UPDATE mail_settings SET imap_last_at=?,imap_due=?,imap_error='',imap_uidvalidity=?,imap_cursor=?,imap_checked=imap_checked+? WHERE id=1").bind(isoNow(),new Date(Date.now()+5*60000).toISOString(),result.uidvalidity,result.cursor,result.reports.length).run();
    return {checked:result.reports.length,matched};
  } catch(error) {
    const code=cleanText(error?.code || 'IMAP_CHECK_FAILED',80);
    await env.DB.prepare('UPDATE mail_settings SET imap_last_at=?,imap_due=?,imap_error=? WHERE id=1').bind(isoNow(),new Date(Date.now()+5*60000).toISOString(),code).run();return {error:code};
  } finally {await release()}
}
async function mailTick(env) {
  await env.DB.prepare('UPDATE mail_settings SET last_tick_at=? WHERE id=1').bind(isoNow()).run();
  const s=await env.DB.prepare('SELECT scan_due,imap_due,imap_enabled FROM mail_settings WHERE id=1').first();
  // Keep network/DB work bounded on the free Worker plan. Both checks run at least every few minutes.
  if(s.scan_due<=isoNow())await scanReleases(env);
  else if(s.imap_enabled && s.imap_due<=isoNow())await pollBounces(env);
  await workflowsTick(env);
  await dispatchMail(env);
}

async function handleReleaseCheck(request,env,ctx) {
  if(new URL(request.url).pathname!=='/api/releases/check')return null;
  if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  try {await verifyReleaseToken((request.headers.get('Authorization') || '').replace(/^Bearer /,''))}catch{return json({ok:false,error:'invalid_release_identity'},401)}
  let body;try{body=await readJson(request,2000000)}catch{return json({ok:false,error:'invalid_release_payload'},400)}
  if(Object.keys(body || {}).length && !body?.releases)return json({ok:false,error:'invalid_release_payload'},400);
  // OIDC is checked before reading or trusting a pushed feed. No GitHub API token leaves Actions.
  const result=await scanReleases(env,true,fetch,body?.releases?body:null);
  if(ctx?.waitUntil)ctx.waitUntil(dispatchMail(env));
  return json({ok:!result.error && !result.busy,...result},result.error || result.busy?503:200);
}
async function handleMailAdmin(request,env,ctx) {
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/admin/automation') {
    if(request.method==='PATCH') {
      const b=await readJson(request,2048);
      if(typeof b.enabled!=='boolean' || typeof b.includePrerelease!=='boolean' || typeof b.imapEnabled!=='boolean')return json({ok:false,error:'invalid_settings'},400);
      const previous=await env.DB.prepare('SELECT enabled FROM mail_settings WHERE id=1').first();
      if(b.enabled && !previous.enabled) {
        const baseline=await scanReleases(env,true);
        if(baseline.error || baseline.busy)return json({ok:false,error:'恢复前的版本检查尚未完成，请稍后重试。'},503);
      }
      await env.DB.prepare("UPDATE mail_settings SET enabled=?,include_prerelease=?,imap_enabled=?,etag='',scan_due='' WHERE id=1").bind(b.enabled?1:0,b.includePrerelease?1:0,b.imapEnabled?1:0).run();
    }
    const settings=await env.DB.prepare('SELECT * FROM mail_settings WHERE id=1').first();
    const groups=await env.DB.prepare("SELECT p.platform,COUNT(*) AS count FROM subscriber_platforms p JOIN subscribers s ON s.id=p.subscriber_id WHERE s.status='subscribed' AND NOT EXISTS(SELECT 1 FROM mail_suppressions x WHERE x.email=s.email) GROUP BY p.platform").all();
    return json({ok:true,settings,groups:groups.results || []});
  }
  if(path==='/api/admin/automation/check' && request.method==='POST') {
    const result=await scanReleases(env,true);if(ctx?.waitUntil)ctx.waitUntil(dispatchMail(env));return json({ok:!result.error,...result},result.error?503:200);
  }
  if(path==='/api/admin/automation/imap' && request.method==='POST') {
    const result=await pollBounces(env,true);return json({ok:!result.error,...result},result.error?503:200);
  }
  if(path==='/api/admin/bounces' && request.method==='GET') {
    const events=await env.DB.prepare('SELECT b.*,c.subject FROM mail_bounces b LEFT JOIN campaigns c ON c.id=b.campaign_id ORDER BY b.created_at DESC LIMIT 100').all();
    const suppressed=await env.DB.prepare('SELECT * FROM mail_suppressions ORDER BY created_at DESC LIMIT 100').all();
    return json({ok:true,bounces:events.results || [],suppressed:suppressed.results || []});
  }
  if(path==='/api/admin/bounces/restore' && request.method==='POST') {
    const b=await readJson(request,1024),email=cleanText(b.email,160).toLowerCase();if(!validEmail(email)||b.confirmEmail!==email)return json({ok:false,error:'请核对邮箱后解除抑制。'},400);
    await env.DB.prepare('DELETE FROM mail_suppressions WHERE email=?').bind(email).run();return json({ok:true});
  }
  if(path==='/api/admin/campaigns' && request.method==='GET') {
    const rows=await env.DB.prepare(campaignSelect+' ORDER BY c.created_at DESC LIMIT 50').all();return json({ok:true,campaigns:rows.results || []});
  }
  const match=path.match(/^\/api\/admin\/campaigns\/([^/]+)(?:\/(preview|test|start|process|progress|cancel|retry))?$/);
  if((path==='/api/admin/campaigns' && request.method==='POST') || match && !match[2] && request.method==='PATCH') {
    const body=await readJson(request,24576),subject=cleanText(body.subject,160),text=cleanText(body.body,20000),audience=body.audience || 'all';
    if(!subject || !text || !['all','windows','mac'].includes(audience))return json({ok:false,error:'请填写邮件标题、正文和收件平台。'},400);
    const id=match?match[1]:crypto.randomUUID(),now=isoNow();
    if(match) {
      const current=await env.DB.prepare(campaignSelect+' WHERE c.id=?').bind(id).first();
      if(current?.status!=='draft')return json({ok:false,error:'只有草稿可以修改。'},409);
      if(body.expectedUpdatedAt && body.expectedUpdatedAt!==current.updated_at)return json({ok:false,error:'草稿已在其他页面更新，请重新打开后编辑。'},409);
      if(current.subject===subject && current.body===text && current.audience===audience)return json({ok:true,id,unchanged:true,updatedAt:current.updated_at});
      const result=await env.DB.prepare("UPDATE campaigns SET subject=?,body=?,test_status='',tested_at=NULL,updated_at=? WHERE id=? AND status='draft' AND updated_at=?").bind(subject,text,now,id,current.updated_at).run();
      if(!Number(result.meta?.changes))return json({ok:false,error:'只有草稿可以修改。'},409);
    } else await env.DB.prepare('INSERT INTO campaigns(id,subject,body,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,subject,text,now,now).run();
    await env.DB.prepare("INSERT INTO campaign_options(campaign_id,audience) VALUES(?,?) ON CONFLICT(campaign_id) DO UPDATE SET audience=excluded.audience").bind(id,audience).run();
    return json({ok:true,id,updatedAt:now});
  }
  if(!match)return null;
  const campaign=await env.DB.prepare(campaignSelect+' WHERE c.id=?').bind(match[1]).first();if(!campaign)return json({ok:false,error:'not_found'},404);
  const action=match[2];
  if(!action && request.method==='GET')return json({ok:true,campaign});
  if(action==='preview')return json({ok:true,campaign,html:campaignContent(campaign,{unsubscribe_token:'preview',confirmation_token:'preview'}).html,recipientCount:await recipientCount(env,campaign.audience)});
  if(action==='progress') {
    const recipients=await env.DB.prepare("SELECT s.email,r.status,r.error_code,r.sent_at,d.attempts,d.next_attempt_at,d.last_stage,d.retry_safe FROM campaign_recipients r JOIN subscribers s ON s.id=r.subscriber_id LEFT JOIN mail_delivery d ON d.campaign_id=r.campaign_id AND d.subscriber_id=r.subscriber_id WHERE r.campaign_id=? ORDER BY r.status,s.email LIMIT 100").bind(campaign.id).all();
    const attempts=await env.DB.prepare('SELECT a.*,s.email FROM mail_attempts a JOIN subscribers s ON s.id=a.subscriber_id WHERE a.campaign_id=? ORDER BY a.created_at DESC LIMIT 100').bind(campaign.id).all();
    return json({ok:true,campaign,progress:await campaignProgress(env,campaign.id),recipients:recipients.results || [],attempts:attempts.results || []});
  }
  if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  if(['test','start','process','retry'].includes(action) && !communityMailReady(env))return json({ok:false,error:'请先配置 QQ SMTP。'},503);
  if(action==='test') {
    if(campaign.status!=='draft')return json({ok:false,error:'只有草稿可以发送测试。'},409);
    try {await sendCommunityMail(env,{to:env.FEEDBACK_TO_EMAIL,replyTo:env.FEEDBACK_TO_EMAIL,...campaignContent({...campaign,subject:'[测试] '+campaign.subject},{unsubscribe_token:'preview',confirmation_token:'preview'})})}
    catch(e){return json({ok:false,error:'测试邮件未发出：'+cleanText(e?.code || 'send_failed',80)},503)}
    const saved=await env.DB.prepare("UPDATE campaigns SET test_status='sent',tested_at=? WHERE id=? AND status='draft' AND updated_at=? AND subject=? AND body=? AND COALESCE((SELECT audience FROM campaign_options WHERE campaign_id=campaigns.id),'all')=?").bind(isoNow(),campaign.id,campaign.updated_at,campaign.subject,campaign.body,campaign.audience).run();
    if(!Number(saved.meta?.changes))return json({ok:false,error:'测试期间草稿已有修改，请重新发送当前内容的测试邮件。'},409);
    return json({ok:true});
  }
  if(action==='start') {
    if(campaign.status!=='draft' || campaign.test_status!=='sent')return json({ok:false,error:'请先向站长邮箱发送测试邮件。'},409);
    const b=await readJson(request,2048);
    if(b.expectedUpdatedAt && b.expectedUpdatedAt!==campaign.updated_at)return json({ok:false,error:'草稿已有更新，请重新预览后发送。'},409);
    const count=await recipientCount(env,campaign.audience);
    if(!count || b.confirmRecipientCount!==count)return json({ok:false,error:'收件人数已变化，请重新预览确认。'},409);
    const now=isoNow(),scheduled=b.scheduledAt?new Date(b.scheduledAt):null;
    if(scheduled && (!Number.isFinite(scheduled.getTime()) || scheduled.getTime()<Date.now()+30000 || scheduled.getTime()>Date.now()+365*86400000))return json({ok:false,error:'预约时间须在 30 秒至一年之后。'},400);
    const status=scheduled?'scheduled':'queued',at=scheduled?scheduled.toISOString():now;
    await env.DB.prepare("INSERT OR IGNORE INTO campaign_options(campaign_id,audience) VALUES(?,?)").bind(campaign.id,campaign.audience).run();
    await env.DB.batch([
      env.DB.prepare(`UPDATE campaigns SET status=?,updated_at=? WHERE id=? AND status='draft' AND test_status='sent' AND updated_at=? AND COALESCE((SELECT audience FROM campaign_options WHERE campaign_id=campaigns.id),'all')=? AND (SELECT COUNT(*) FROM subscribers s WHERE ${audienceWhere})=?`).bind(status,now,campaign.id,campaign.updated_at,campaign.audience,campaign.audience,campaign.audience,count),
      env.DB.prepare("UPDATE campaign_options SET scheduled_at=? WHERE campaign_id=? AND EXISTS(SELECT 1 FROM campaigns c WHERE c.id=campaign_id AND c.updated_at=? AND c.status=?)").bind(at,campaign.id,now,status),
      env.DB.prepare(`INSERT OR IGNORE INTO campaign_recipients(campaign_id,subscriber_id) SELECT ?,s.id FROM subscribers s WHERE ${audienceWhere} AND EXISTS(SELECT 1 FROM campaigns c WHERE c.id=? AND c.status=? AND c.updated_at=?)`).bind(campaign.id,campaign.audience,campaign.audience,campaign.id,status,now)
    ]);
    const saved=await env.DB.prepare('SELECT status,updated_at FROM campaigns WHERE id=?').bind(campaign.id).first();
    if(saved.status!==status || saved.updated_at!==now)return json({ok:false,error:'收件人数或状态已变化，请刷新后重试。'},409);
    if(!scheduled && ctx?.waitUntil)ctx.waitUntil(dispatchMail(env));
    return json({ok:true,status,scheduledAt:at,progress:await campaignProgress(env,campaign.id)});
  }
  if(action==='process') {
    if(!['sending','queued','retry_wait'].includes(campaign.status))return json({ok:false,error:'此邮件不在发送状态。'},409);
    return json({ok:true,progress:await dispatchCampaign(env,campaign)});
  }
  if(action==='cancel') {
    const result=await env.DB.prepare("UPDATE campaigns SET status='cancelled',updated_at=? WHERE id=? AND status IN ('scheduled','queued')").bind(isoNow(),campaign.id).run();
    if(!Number(result.meta?.changes))return json({ok:false,error:'已开始发送的邮件无法撤回，请刷新查看进度。'},409);
    await env.DB.prepare("UPDATE campaign_recipients SET status='cancelled' WHERE campaign_id=? AND status='pending'").bind(campaign.id).run();return json({ok:true});
  }
  if(action==='retry') {
    if(!['partial_failure','sent','sending','retry_wait'].includes(campaign.status))return json({ok:false,error:'此邮件暂不能重试。'},409);
    const result=await env.DB.prepare("UPDATE campaign_recipients SET status='retry_wait' WHERE campaign_id=? AND status='failed' AND EXISTS(SELECT 1 FROM mail_delivery d WHERE d.campaign_id=campaign_recipients.campaign_id AND d.subscriber_id=campaign_recipients.subscriber_id AND d.retry_safe=1) AND EXISTS(SELECT 1 FROM subscribers s WHERE s.id=subscriber_id AND s.status='subscribed' AND NOT EXISTS(SELECT 1 FROM mail_suppressions x WHERE x.email=s.email))").bind(campaign.id).run();
    if(!Number(result.meta?.changes))return json({ok:false,error:'没有可安全重试的失败地址。已发送、退信或状态待核实的邮件不会重发。'},409);
    await env.DB.batch([env.DB.prepare("UPDATE mail_delivery SET next_attempt_at='' WHERE campaign_id=? AND retry_safe=1").bind(campaign.id),env.DB.prepare("UPDATE campaigns SET status='retry_wait',updated_at=? WHERE id=?").bind(isoNow(),campaign.id)]);
    return json({ok:true,retried:Number(result.meta.changes)});
  }
  return null;
}

// Authenticated dashboard read models. No credentials or subscription tokens leave these endpoints.
function subscriberFilter(request) {
  const url=new URL(request.url),q=cleanText(url.searchParams.get('q'),160),status=cleanText(url.searchParams.get('status'),20);
  const platform=['mac','windows'].includes(url.searchParams.get('platform'))?url.searchParams.get('platform'):'';
  const page=Math.max(1,Math.min(100000,Number(url.searchParams.get('page')) || 1));
  return {page,where:"WHERE s.email LIKE ? ESCAPE '\\' AND (?='' OR s.status=?) AND (?='' OR EXISTS(SELECT 1 FROM subscriber_platforms p WHERE p.subscriber_id=s.id AND p.platform=?))",values:['%'+q.replace(/[\\%_]/g,'\\$&')+'%',status,status,platform,platform]};
}
async function dashboardSubscribers(request,env) {
  const {page,where,values}=subscriberFilter(request);
  const [count,rows,stats]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM subscribers s ${where}`).bind(...values).first(),
    env.DB.prepare(`SELECT s.id,s.email,s.status,s.locale,s.platform,(SELECT GROUP_CONCAT(platform) FROM subscriber_platforms WHERE subscriber_id=s.id) AS platforms,(SELECT reason FROM mail_suppressions WHERE email=s.email) AS suppression_reason,s.consent_at,s.confirmed_at,s.created_at,s.last_download_at,(SELECT status FROM subscriber_mail_log WHERE subscriber_id=s.id ORDER BY created_at DESC LIMIT 1) AS thank_you_status FROM subscribers s ${where} ORDER BY s.created_at DESC,s.id LIMIT 50 OFFSET ?`).bind(...values,(page-1)*50).all(),
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(status='subscribed') AS subscribed,SUM(status='pending') AS pending,SUM(status='contact') AS contact,SUM(status='unsubscribed') AS unsubscribed,SUM(status='subscribed' AND NOT EXISTS(SELECT 1 FROM mail_suppressions x WHERE x.email=subscribers.email)) AS eligible FROM subscribers").first()
  ]);
  return json({ok:true,subscribers:rows.results || [],total:Number(count?.count || 0),page,stats});
}
async function dashboardExport(request,env) {
  const {where,values}=subscriberFilter(request);
  const rows=await env.DB.prepare(`SELECT s.email,s.status,s.locale,s.platform,(SELECT GROUP_CONCAT(platform) FROM subscriber_platforms WHERE subscriber_id=s.id) AS platforms,(SELECT reason FROM mail_suppressions WHERE email=s.email) AS suppression_reason,s.consent_at,s.confirmed_at,s.created_at,s.last_download_at FROM subscribers s ${where} ORDER BY s.created_at DESC`).bind(...values).all();
  const columns=['email','status','locale','platform','platforms','suppression_reason','consent_at','confirmed_at','created_at','last_download_at'];
  return new Response('\ufeff'+[columns.map(csvCell).join(','),...(rows.results || []).map(row=>columns.map(k=>csvCell(row[k])).join(','))].join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename=musefilm-subscribers.csv','Cache-Control':'no-store'}});
}
async function dashboardOverview(env) {
  const since=new Date(Date.now()-30*86400000).toISOString();
  const fromDay=new Date(Date.now()+8*3600000-6*86400000).toISOString().slice(0,10);
  const [visits,downloads,subscribers,mail,feedback,viewsByDay,downloadsByDay,settings,recent,groups]=await Promise.all([
    env.DB.prepare("SELECT value AS count FROM site_counters WHERE name='page_views'").first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM download_events WHERE created_at>=?').bind(since).first(),
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(status='subscribed' AND NOT EXISTS(SELECT 1 FROM mail_suppressions x WHERE x.email=subscribers.email)) AS eligible FROM subscribers").first(),
    env.DB.prepare("SELECT SUM(status IN ('pending','retry_wait','sending')) AS queued,SUM(status IN ('failed','bounced','uncertain')) AS attention,SUM(status='sent') AS accepted FROM campaign_recipients").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM feedback WHERE status IN ('new','reviewing')").first(),
    env.DB.prepare("SELECT date(created_at,'+8 hours') AS day,COUNT(*) AS count FROM visit_events WHERE date(created_at,'+8 hours')>=? GROUP BY day ORDER BY day").bind(fromDay).all(),
    env.DB.prepare("SELECT date(created_at,'+8 hours') AS day,COUNT(*) AS count FROM download_events WHERE date(created_at,'+8 hours')>=? GROUP BY day ORDER BY day").bind(fromDay).all(),
    env.DB.prepare('SELECT * FROM mail_settings WHERE id=1').first(),
    env.DB.prepare(campaignSelect+' ORDER BY c.updated_at DESC LIMIT 5').all(),
    env.DB.prepare("SELECT p.platform,COUNT(*) AS count FROM subscriber_platforms p JOIN subscribers s ON s.id=p.subscriber_id WHERE s.status='subscribed' AND NOT EXISTS(SELECT 1 FROM mail_suppressions x WHERE x.email=s.email) GROUP BY p.platform").all()
  ]);
  return json({ok:true,preview:Boolean(env.LOCAL_PREVIEW),totals:{visits:Number(visits?.count || 0),downloads:Number(downloads?.count || 0),subscribers:Number(subscribers?.eligible || 0),contacts:Number(subscribers?.total || 0),queued:Number(mail?.queued || 0),accepted:Number(mail?.accepted || 0),attention:Number(mail?.attention || 0),feedback:Number(feedback?.count || 0)},audiences:{all:Number(subscribers?.eligible || 0),mac:0,windows:0,...Object.fromEntries((groups.results || []).map(row=>[row.platform,Number(row.count)]))},daily:{views:viewsByDay.results || [],downloads:downloadsByDay.results || []},settings,mailReady:communityMailReady(env),campaigns:recent.results || [],updatedAt:isoNow()});
}
async function handleDashboardAdmin(request,env) {
  const path=new URL(request.url).pathname;
  if(path==='/api/admin/overview' && request.method==='GET')return dashboardOverview(env);
  const feedback=path.match(/^\/api\/admin\/feedback\/([^/]+)$/);
  if(feedback && request.method==='PATCH') {
    const body=await readJson(request,1024);
    if(!['new','reviewing','resolved','archived'].includes(body.status))return json({ok:false,error:'请选择有效的反馈状态。'},400);
    const result=await env.DB.prepare('UPDATE feedback SET status=? WHERE id=?').bind(body.status,feedback[1]).run();
    return Number(result.meta?.changes)?json({ok:true}):json({ok:false,error:'反馈不存在。'},404);
  }
  return null;
}

// Server-side owner reports, consent-based feedback follow-ups and release review drafts.
const WORKFLOW_FEEDBACK_URL='https://musefilm.top/?feedback=1#download';
function reportWindow(settings,now=new Date()) {
  const local=new Date(now.getTime()+8*3600000),[hour,minute]=settings.weekly_time.split(':').map(Number);
  const due=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),hour,minute));
  due.setUTCDate(due.getUTCDate()-(local.getUTCDay()-settings.weekly_day+7)%7);
  if(due>local)due.setUTCDate(due.getUTCDate()-7);
  const monday=new Date(due);monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
  const end=new Date(due.getTime()-8*3600000);
  return {key:monday.toISOString().slice(0,10),start:new Date(end.getTime()-7*86400000).toISOString(),end:end.toISOString()};
}
async function reportMetrics(env,start,end) {
  const [visits,downloads,subscriptions,feedback]=await Promise.all([
    env.DB.prepare('SELECT COUNT(*) n FROM visit_events WHERE created_at>=? AND created_at<?').bind(start,end).first(),
    env.DB.prepare("SELECT COUNT(*) n,SUM(platform='windows') windows,SUM(platform='mac') mac FROM download_events WHERE created_at>=? AND created_at<?").bind(start,end).first(),
    env.DB.prepare("SELECT COUNT(DISTINCT CASE WHEN event='subscribed' THEN subscriber_id END) subscribed,COUNT(DISTINCT CASE WHEN event='unsubscribed' THEN subscriber_id END) unsubscribed FROM subscription_events WHERE created_at>=? AND created_at<?").bind(start,end).first(),
    env.DB.prepare("SELECT SUM(status IN ('new','reviewing')) pending,SUM(created_at>=? AND created_at<?) received FROM feedback").bind(start,end).first()
  ]);
  return {visits:Number(visits?.n||0),downloads:Number(downloads?.n||0),windows:Number(downloads?.windows||0),mac:Number(downloads?.mac||0),subscribed:Number(subscriptions?.subscribed||0),unsubscribed:Number(subscriptions?.unsubscribed||0),feedback:Number(feedback?.received||0),pendingFeedback:Number(feedback?.pending||0)};
}
function ownerReportContent(report,test=false) {
  const m=typeof report.metrics==='string'?JSON.parse(report.metrics):report.metrics;
  const local=t=>new Date(Date.parse(t)+8*3600000).toISOString().slice(0,16).replace('T',' ');
  const title='MuseFilm 每周运营简报',paragraphs=[`统计区间：${local(report.period_start)} 至 ${local(report.period_end)}（北京时间，结束时刻不计入本期）`,
    `网站访问：${m.visits} 次（含重复访问）\n下载点击：${m.downloads} 次\nWindows：${m.windows} 次 · macOS：${m.mac} 次`,
    `新增 / 恢复订阅：${m.subscribed} 人\n退订：${m.unsubscribed} 人`,
    `本期收到反馈：${m.feedback} 条\n当前待处理反馈：${m.pendingFeedback} 条`,
    '下载点击不代表安装完成。订阅和退订按本期发生的状态变更统计；启用前未留存的历史变更不追溯。'];
  return {subject:(test?'[测试] ':'')+title+' · '+local(report.period_end).slice(0,10),text:paragraphs.join('\n\n')+'\n\n后台：'+COMMUNITY_ORIGIN+'/admin#overview',html:subscriberEmailHtml(title,paragraphs,emailButton(COMMUNITY_ORIGIN+'/admin#overview','打开管理后台'),'此简报只发送至站长邮箱，可在后台「自动化」中调整时间或关闭。')};
}
function releaseDraftBody(item) {
  const label=item.platform==='mac'?'macOS':'Windows';
  const bullets=[],paragraphs=[],images=[];let include=true;
  for(const raw of item.notes.split(/\r?\n/)) {
    const heading=raw.match(/^#{1,6}\s+(.+)/);
    if(heading){if(/历史版本|历史更新/.test(heading[1]))break;include=!/版本信息|安装|发布验证|SHA.?256|校验|反馈|签名|构建|测试/.test(heading[1]);continue}
    const withoutImages=raw.replace(emailImagePattern(),(match,alt,value)=>{const url=emailImageUrl(value);if(include && url && images.length<4 && !images.some(i=>i.url===url))images.push({url,alt:alt.trim() || 'MuseFilm 功能预览'});return ''});
    const line=withoutImages.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').trim();
    if(!include || !line || /^\||^[-_*]{3,}$|^https?:/.test(line))continue;
    if(/^[-*+]\s+/.test(line))bullets.push(line.replace(/^[-*+]\s+/,''));else if(!/^>/.test(line))paragraphs.push(line);
  }
  const selected=(bullets.length?bullets:paragraphs).slice(0,6),notes=selected.map(line=>'• '+(line.length>180?line.slice(0,180)+'…':line)).join('\n') || '本次更新已经准备好，欢迎查看完整版本说明。';
  return `你好，\n\nMuseFilm ${label} ${item.title}${item.preview?'（预览版）':''} 已准备好。\n\n这次更新带来了这些改进：\n${notes}${images.length?'\n\n'+images.map(i=>'!['+i.alt+']('+i.url+')').join('\n\n'):''}\n\n查看完整说明与下载：\n${item.url}\n\n用起来有什么感受或建议，欢迎直接回复这封邮件。谢谢你陪 MuseFilm 留住每一卷光。`;
}
async function followupAllowed(env,subscriberId) {
  const row=await env.DB.prepare("SELECT s.id FROM subscribers s WHERE s.id=? AND s.status='subscribed' AND (SELECT followup_enabled FROM workflow_settings WHERE id=1)=1 AND NOT EXISTS(SELECT 1 FROM mail_suppressions x WHERE x.email=s.email) AND NOT EXISTS(SELECT 1 FROM feedback f WHERE lower(trim(f.contact_email))=s.email)").bind(subscriberId).first();
  return Boolean(row);
}
async function queueWorkflows(env,now=new Date()) {
  const s=await env.DB.prepare('SELECT * FROM workflow_settings WHERE id=1').first();if(!s)return;
  const at=now.toISOString(),w=reportWindow(s,now);
  if(s.weekly_enabled && w.end>=s.activated_at && !await env.DB.prepare('SELECT id FROM weekly_reports WHERE period_key=?').bind(w.key).first()) {
    const metrics=await reportMetrics(env,w.start,w.end);
    await env.DB.prepare('INSERT OR IGNORE INTO weekly_reports(id,period_key,period_start,period_end,metrics,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),w.key,w.start,w.end,JSON.stringify(metrics),at).run();
  }
  if(s.followup_enabled) {
    const cutoff=new Date(now.getTime()-s.followup_days*86400000).toISOString();
    const rows=await env.DB.prepare("SELECT s.id,s.platform,MIN(d.created_at) downloaded_at FROM subscribers s JOIN subscriber_downloads sd ON sd.subscriber_id=s.id JOIN download_events d ON d.id=sd.download_id WHERE s.status='subscribed' AND d.created_at>=? AND NOT EXISTS(SELECT 1 FROM mail_suppressions x WHERE x.email=s.email) AND NOT EXISTS(SELECT 1 FROM feedback f WHERE lower(trim(f.contact_email))=s.email) AND NOT EXISTS(SELECT 1 FROM campaign_options o WHERE o.source_key='followup:'||s.id) GROUP BY s.id HAVING MIN(d.created_at)<=? ORDER BY downloaded_at LIMIT 10").bind(s.activated_at,cutoff).all();
    const statements=[];
    for(const row of rows.results||[]) {
      const id=crypto.randomUUID(),body='你好，\n\n前些天你下载了 MuseFilm，用起来还顺手吗？\n\n有没有哪个步骤让你困惑，或者想要增加的新功能？欢迎用一两句话告诉我，也可以直接回复这封邮件。\n\n反馈入口：\n'+WORKFLOW_FEEDBACK_URL+'\n\n谢谢你的时间，愿每一卷光都被好好留下。';
      statements.push(env.DB.prepare("INSERT INTO campaigns(id,subject,body,status,test_status,created_at,updated_at) VALUES(?,'MuseFilm 用起来怎么样？期待你的反馈',?,'queued','automatic',?,?)").bind(id,body,at,at));
      statements.push(env.DB.prepare("INSERT INTO campaign_options(campaign_id,audience,kind,source_key,scheduled_at,release_url) VALUES(?,'all','followup',?,?,?)").bind(id,'followup:'+row.id,at,WORKFLOW_FEEDBACK_URL));
      statements.push(env.DB.prepare('INSERT INTO campaign_recipients(campaign_id,subscriber_id) VALUES(?,?)').bind(id,row.id));
    }
    if(statements.length)await env.DB.batch(statements);
  }
  await env.DB.prepare("UPDATE workflow_settings SET last_run_at=?,last_error='' WHERE id=1").bind(at).run();
}
async function dispatchOwnerReport(env) {
  if(!communityMailReady(env))return;
  const now=isoNow();
  await env.DB.prepare("UPDATE weekly_reports SET status='uncertain',error_code='SEND_LEASE_EXPIRED' WHERE status='sending' AND lease_until<?").bind(now).run();
  const row=await env.DB.prepare("SELECT * FROM weekly_reports WHERE status IN ('pending','retry_wait') AND next_attempt_at<=? ORDER BY period_end LIMIT 1").bind(now).first();if(!row)return;
  if(!(await env.DB.prepare('SELECT weekly_enabled FROM workflow_settings WHERE id=1').first())?.weekly_enabled)return;
  const lease=crypto.randomUUID();
  const claimed=await env.DB.prepare("UPDATE weekly_reports SET status='sending',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=? AND status IN ('pending','retry_wait') AND lease_token IS NULL RETURNING attempts").bind(lease,new Date(Date.now()+90000).toISOString(),row.id).first();if(!claimed)return;
  let status='sent',code='',next='',safe=false;
  try {await sendCommunityMail(env,{to:env.FEEDBACK_TO_EMAIL,from:env.FEEDBACK_FROM_EMAIL,replyTo:env.FEEDBACK_TO_EMAIL,...ownerReportContent(row),messageId:'mf-report-'+row.period_key+'@musefilm.top'})}
  catch(error){const result=deliveryClass(error,claimed.attempts);status=result.status==='bounced'?'failed':result.status;code=cleanText(error.code||'SMTP_UNKNOWN',80);safe=result.safe;if(status==='retry_wait')next=new Date(Date.now()+RETRY_DELAYS[claimed.attempts-1]).toISOString()}
  await env.DB.prepare('UPDATE weekly_reports SET status=?,error_code=?,retry_safe=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,sent_at=? WHERE id=? AND lease_token=?').bind(status,code,safe?1:0,next,status==='sent'?isoNow():null,row.id,lease).run();
}
async function workflowsTick(env) {
  const release=await mailLock(env,'operations',75);if(!release)return;
  try {await queueWorkflows(env);await dispatchOwnerReport(env)}
  catch(error){await env.DB.prepare('UPDATE workflow_settings SET last_run_at=?,last_error=? WHERE id=1').bind(isoNow(),cleanText(error.code||'WORKFLOW_FAILED',80)).run()}
  finally {await release()}
}
async function handleWorkflowsAdmin(request,env) {
  const path=new URL(request.url).pathname;if(!path.startsWith('/api/admin/workflows'))return null;
  if(path==='/api/admin/workflows') {
    if(request.method==='PATCH') {
      const b=await readJson(request,2048);
      if(!['draft','auto'].includes(b.releaseMode) || typeof b.weeklyEnabled!=='boolean' || !Number.isInteger(b.weeklyDay) || b.weeklyDay<0 || b.weeklyDay>6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.weeklyTime||'') || typeof b.followupEnabled!=='boolean' || !Number.isInteger(b.followupDays) || b.followupDays<1 || b.followupDays>30)return json({ok:false,error:'请检查发送时间与回访天数（1–30 天）。'},400);
      await env.DB.prepare('UPDATE workflow_settings SET release_mode=?,weekly_enabled=?,weekly_day=?,weekly_time=?,followup_enabled=?,followup_days=?,updated_at=? WHERE id=1').bind(b.releaseMode,b.weeklyEnabled?1:0,b.weeklyDay,b.weeklyTime,b.followupEnabled?1:0,b.followupDays,isoNow()).run();
    }else if(request.method!=='GET')return json({ok:false,error:'method_not_allowed'},405);
    const settings=await env.DB.prepare('SELECT * FROM workflow_settings WHERE id=1').first(),reports=await env.DB.prepare('SELECT id,period_start,period_end,status,attempts,error_code,sent_at,retry_safe FROM weekly_reports ORDER BY period_end DESC LIMIT 5').all();
    const followups=await env.DB.prepare("SELECT r.status,COUNT(*) count FROM campaign_recipients r JOIN campaign_options o ON o.campaign_id=r.campaign_id WHERE o.kind='followup' GROUP BY r.status").all();
    return json({ok:true,settings,reports:reports.results||[],followups:followups.results||[],nextWeeklyAt:nextWeekly(settings)});
  }
  if(['/api/admin/workflows/report-preview','/api/admin/workflows/report-test'].includes(path)) {
    const end=isoNow(),start=new Date(Date.now()-7*86400000).toISOString(),report={period_start:start,period_end:end,metrics:await reportMetrics(env,start,end)},content=ownerReportContent(report,true);
    if(path.endsWith('report-test')) {if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);await sendCommunityMail(env,{to:env.FEEDBACK_TO_EMAIL,from:env.FEEDBACK_FROM_EMAIL,replyTo:env.FEEDBACK_TO_EMAIL,...content});return json({ok:true})}
    return json({ok:true,...content});
  }
  if(path==='/api/admin/workflows/release-draft' && request.method==='POST') {
    const b=await readJson(request,1024);if(!['mac','windows'].includes(b.platform))return json({ok:false,error:'请选择平台。'},400);
    const s=await env.DB.prepare('SELECT * FROM mail_settings WHERE id=1').first(),feed=await releaseFeed({...s,etag:''},fetch);
    const item=releaseVariants(feed.releases,Boolean(s.include_prerelease)).filter(r=>r.platform===b.platform).sort((a,b)=>Date.parse(b.published)-Date.parse(a.published))[0];
    if(!item)return json({ok:false,error:'没有找到该平台的可用版本。'},404);
    const key='review:'+item.key,existing=await env.DB.prepare('SELECT campaign_id FROM campaign_options WHERE source_key IN (?,?)').bind(key,item.key).first();if(existing)return json({ok:true,id:existing.campaign_id,existing:true});
    const id=crypto.randomUUID(),now=isoNow(),label=item.platform==='mac'?'macOS':'Windows';
    await env.DB.batch([env.DB.prepare("INSERT INTO campaigns(id,subject,body,created_at,updated_at) VALUES(?,?,?,?,?)").bind(id,`MuseFilm ${label} ${item.title} 已发布`,releaseDraftBody(item),now,now),env.DB.prepare("INSERT INTO campaign_options(campaign_id,audience,kind,source_key,release_url) VALUES(?,?,'release',?,?)").bind(id,item.platform,key,item.url)]);
    return json({ok:true,id});
  }
  return json({ok:false,error:'not_found'},404);
}
function nextWeekly(s,now=new Date()) {
  const w=reportWindow(s,now);return new Date(Date.parse(w.end)+7*86400000).toISOString();
}

// END GENERATED COMMUNITY

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      const status = error?.message === "payload_too_large"
        ? 413
        : (error?.message === "invalid_json" ? 400 : (error?.message === "service_not_configured" ? 503 : 500));
      if (status === 500) {
        console.error(JSON.stringify({
          message: "MuseFilm API error",
          path: new URL(request.url).pathname,
          error: cleanText(error?.message || error, 200),
        }));
      }
      return json({ ok: false, error: status === 500 ? "internal_error" : error.message }, status, corsHeaders(request, env));
    }
  },
  async scheduled(event, env) {
    await mailTick(env);
    if(event.cron !== "17 3 * * *") return;
    await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(new Date().toISOString()).run();
    await env.DB.prepare("DELETE FROM admin_login_codes WHERE expires_at < ?").bind(new Date().toISOString()).run();
    const result = await env.DB.prepare("DELETE FROM visit_events WHERE created_at < datetime('now','-90 days')").run();
    console.log(JSON.stringify({ message: "expired visits removed", changes: Number(result.meta?.changes || 0) }));
    await env.DB.prepare("DELETE FROM download_events WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')").run();
  },
};

export const __test = { campaignBodyContent, campaignContent, emailImageUrl, prepareInlineEmailImages, thankYouContent, smtpMime, sendQqSmtp, csvCell, communityMailReady, installerInfo, downloadEmailContent, browserFamily, cleanText, escapeHtml, feedbackEmailHtml, normalizePage, normalizePath, publicAfterglowNote, validEmail, deliveryClass, dispatchCampaign, dispatchMail, scanReleases, releaseVariants, verifyReleaseToken, reportWindow, reportMetrics, ownerReportContent, queueWorkflows, dispatchOwnerReport, workflowsTick, releaseDraftBody, parseBounceReport, applyBounceReport, qqImapReports, pollBounces, mailTick };
