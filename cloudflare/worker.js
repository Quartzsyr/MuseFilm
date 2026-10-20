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
const PUBLIC_API_PATHS = new Set(["/api/config", "/api/visit", "/api/visitors", "/api/feedback", "/api/download"]);

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

async function handleRequest(request, env, ctx) {
  const communityResponse = await handleCommunity(request, env, ctx);
  if (communityResponse) return communityResponse;
  const url = new URL(request.url);
  const headers = corsHeaders(request, env);
  const isPublicApi = PUBLIC_API_PATHS.has(url.pathname);
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
  if (url.pathname === "/api/admin/stats" && request.method === "GET") return adminStats(request, env, headers);
  if (url.pathname === "/api/admin/feedback" && request.method === "GET") return adminFeedback(request, env, headers);
  if (url.pathname === "/api/admin/downloads" && request.method === "GET") return adminDownloads(request, env, headers);
  if (url.pathname === "/health" && request.method === "GET") {
    await env.DB.prepare("SELECT 1").first();
    return json({ ok: true, service: "musefilm-feedback-api" }, 200, headers);
  }
  return json({ ok: false, error: "not_found" }, 404, headers);
}

// BEGIN GENERATED COMMUNITY
const ADMIN_PAGE_HTML = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>MuseFilm · 暗房来信</title><style>\n:root{color-scheme:dark;--bg:#0a0a09;--panel:#141412;--line:#302d29;--muted:#99938a;--text:#f2efe8;--accent:#b55245;font-family:Inter,-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-size:14px}button,input,select,textarea{font:inherit}button,a.button{cursor:pointer;border:1px solid #4d3d36;background:#251d19;color:var(--text);padding:11px 17px;border-radius:10px;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px}button:hover,a.button:hover{border-color:#987663}button:disabled{opacity:.4;cursor:not-allowed}.primary{background:linear-gradient(130deg,#a14b3e,#75352f);border-color:#c57462}.quiet{background:transparent;border-color:var(--line);color:var(--muted)}a{color:#d9b99b}input,select,textarea{width:100%;border:1px solid var(--line);border-radius:10px;background:#10100f;color:var(--text);padding:12px 14px;outline:none}input:focus,textarea:focus,select:focus{border-color:#c57462;box-shadow:0 0 0 3px #b552451a}textarea{resize:vertical;line-height:1.9}h1,h2,h3,p{margin:0}h1{font-size:clamp(30px,4vw,46px);font-weight:600;letter-spacing:-.05em;line-height:1.15}h2{font-size:24px;font-weight:500;letter-spacing:-.04em}p{line-height:1.8;color:var(--muted)}small,.muted{color:var(--muted)}[hidden]{display:none!important}.eyebrow{font-size:10px;color:#ca9f82;letter-spacing:.18em;text-transform:uppercase}.login-shell{min-height:100svh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 75% 10%,#42221e70,transparent 55%)}.login-card{width:min(460px,100%);padding:36px;border:1px solid var(--line);border-radius:24px;background:#161512cc;box-shadow:0 28px 100px #0006}.login-card h1{margin:20px 0}.login-card form{margin-top:26px;display:grid;gap:14px}.login-card label{display:grid;gap:10px;color:var(--muted);font-size:12px}.brand{font-size:18px;letter-spacing:-.05em}.brand:before{content:'◫';display:inline-grid;place-items:center;width:32px;height:32px;margin-right:10px;background:#3e2921;color:#dfbd9a;border:1px solid #6f4c39;border-radius:8px;vertical-align:middle}.layout{display:grid;grid-template-columns:220px 1fr;min-height:100svh}aside{position:sticky;top:0;height:100svh;border-right:1px solid var(--line);padding:30px 20px;background:#10100e}aside nav{display:grid;gap:8px;margin-top:48px}aside nav button{justify-content:flex-start;background:none;border-color:transparent;color:var(--muted);padding:13px 14px}aside nav button.active{background:#a14b3e19;border-color:#a14b3e50;color:#e9d8c7}aside .bottom{position:absolute;bottom:28px;left:22px;right:22px;display:grid;gap:14px;font-size:11px}main{padding:44px clamp(20px,4vw,64px);min-width:0;max-width:1600px;width:100%;margin:auto}.top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:36px}.top h1{margin-top:10px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0}.stat{border:1px solid var(--line);border-radius:16px;padding:23px;background:linear-gradient(135deg,#1c1915,#11110f)}.stat span{display:block;color:var(--muted);font-size:11px;letter-spacing:.04em}.stat b{display:block;font-size:34px;font-weight:400;letter-spacing:-.05em;margin-top:16px}.section-head{display:flex;justify-content:space-between;align-items:center;gap:20px;margin:28px 0 18px}.section-head p{font-size:12px;margin-top:8px}.filters{display:grid;grid-template-columns:minmax(180px,1fr) 160px auto;gap:10px;margin-bottom:18px}.table-shell{border:1px solid var(--line);border-radius:16px;overflow:auto;background:#11110f}table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:12px}th{text-align:left;padding:15px 18px;border-bottom:1px solid var(--line);font-size:10px;font-weight:400;color:var(--muted);letter-spacing:.06em}td{padding:18px;border-bottom:1px solid #24221f}tbody tr:last-child td{border-bottom:0}td small{font-size:10px;display:block;margin-top:5px}.badge{display:inline-block;padding:4px 9px;border:1px solid #454039;border-radius:99px;background:#29251f;color:#c9b39a;font-size:10px}.badge.subscribed,.badge.sent{border-color:#385345;background:#1c2e25;color:#b7d1bd}.badge.pending,.badge.sending{border-color:#67502b;color:#e4c793;background:#342a18}.badge.failed,.badge.partial_failure{border-color:#683c38;color:#df9d94;background:#301f1c}.empty{text-align:center;color:var(--muted);padding:48px}.pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;color:var(--muted);font-size:12px}.compose-grid{display:grid;grid-template-columns:minmax(280px,.95fr) minmax(300px,1fr);gap:22px}.panel{padding:26px;border:1px solid var(--line);border-radius:18px;background:#141310}.editor{display:grid;gap:17px;align-content:start}.editor label{display:grid;gap:10px;color:var(--muted);font-size:12px}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.preview{width:100%;height:650px;border:0;background:#090909;border-radius:12px;margin-top:18px}.message{min-height:22px;font-size:12px;line-height:1.7;color:#d7b596}.campaign-item{padding:18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;align-items:center}.campaign-item:last-child{border-bottom:0}.campaign-item strong{font-weight:500}.campaign-item p{font-size:11px;margin-top:7px}.history{margin-top:24px}.progress{padding:14px 0;color:#d7c2a9;font-size:12px;line-height:1.9}dialog{width:min(460px,calc(100vw - 32px));padding:28px;border:1px solid #6a493e;border-radius:20px;background:linear-gradient(145deg,#271c18,#11110f);color:var(--text)}dialog::backdrop{background:#000b;backdrop-filter:blur(6px)}dialog h2{margin-bottom:14px}dialog p{margin-bottom:18px}dialog input{margin-bottom:18px}dialog .actions{justify-content:flex-end}.notice{border-left:2px solid #a57854;padding:12px 18px;margin-bottom:20px;background:#211c1570;font-size:12px;line-height:1.8;color:#b9aa98}#toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:14px 20px;max-width:calc(100vw - 32px);border:1px solid #685044;border-radius:12px;background:#231c17;box-shadow:0 20px 70px #0008;z-index:10;line-height:1.7;font-size:13px}.wordmark{position:relative;padding-left:20px}.wordmark:before{content:'';position:absolute;left:0;top:5px;width:5px;height:5px;border-radius:50%;background:#b55245}.tiny-button{padding:6px 10px;font-size:11px}@media(max-width:1000px){.layout{grid-template-columns:180px 1fr}.compose-grid{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.layout{display:block}aside{height:auto;position:relative;padding:18px;border-right:0;border-bottom:1px solid var(--line)}aside nav{display:flex;gap:4px;margin-top:18px}aside .bottom{position:static;display:flex;justify-content:space-between;margin-top:16px}main{padding:28px 18px}.top{align-items:flex-start}.top>.quiet{padding:9px;font-size:11px}.filters{grid-template-columns:1fr 130px}.filters button{grid-column:1/-1}.panel{padding:20px}.stats{gap:10px}.stat{padding:18px}.section-head{align-items:flex-start}.login-card{padding:28px}.preview{height:580px}}\n\n.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-bottom:24px}.toggle{display:flex!important;grid-template-columns:auto 1fr;align-items:center;gap:12px!important;line-height:1.8}.toggle input{width:18px;height:18px;accent-color:#b55245}.detail{margin-top:18px;line-height:1.9;font-size:12px;overflow-wrap:anywhere}.detail p{margin:6px 0}.campaign-item>div{min-width:0}.campaign-item strong{overflow-wrap:anywhere}.badge.uncertain,.badge.bounced{border-color:#683c38;color:#df9d94}.badge.scheduled,.badge.retry_wait{color:#e4c793}.delivery-panel{margin-top:20px}.delivery-panel summary{cursor:pointer;padding:14px 0;color:#d9b99b}.delivery-panel table{white-space:normal}.delivery-panel td{min-width:110px}.editor small{line-height:1.8}@media(max-width:1000px){.settings-grid{grid-template-columns:1fr}}@media(max-width:700px){aside nav{flex-wrap:wrap}aside nav button{padding:9px;font-size:12px}.campaign-item{flex-direction:column;align-items:stretch}.settings-grid{gap:14px}}\n</style></head><body>\n<section class=\"login-shell\" id=\"login\"><div class=\"login-card\"><div class=\"brand\">MuseFilm</div><p class=\"eyebrow\" style=\"margin-top:36px\">THE LETTERS WE KEEP</p><h1>回到你的暗房。</h1><p>整理留下的邮箱，把下一卷消息寄给愿意听见的人。</p><form id=\"login-form\"><button class=\"primary\" type=\"button\" id=\"request-code\">发送站长登录验证码 ↗</button><label>邮箱验证码<input name=\"code\" inputmode=\"numeric\" autocomplete=\"one-time-code\" maxlength=\"8\" pattern=\"[0-9]{8}\" placeholder=\"8 位验证码\" required></label><button type=\"submit\" id=\"login-submit\" class=\"quiet\">进入后台</button><p class=\"message\" id=\"login-message\" role=\"status\"></p></form><p style=\"margin-top:28px;font-size:11px\">验证码只会发送至已配置的站长邮箱，10 分钟内有效。</p><a href=\"https://musefilm.top\" style=\"display:inline-block;margin-top:20px;font-size:12px\">回到网站 ↗</a></div></section>\n<div class=\"layout\" id=\"dashboard\" hidden><aside><div class=\"brand\">MuseFilm</div><p class=\"eyebrow\" style=\"margin-top:12px\">暗房来信 / STUDIO</p><nav aria-label=\"后台导航\"><button class=\"active\" data-tab=\"subscribers\">◉　邮箱档案</button><button data-tab=\"campaigns\">↗　更新与新闻</button><button data-tab=\"automation\">◷　自动寄信</button><button data-tab=\"downloads\">◫　下载记录</button></nav><div class=\"bottom\"><a href=\"https://musefilm.top\" target=\"_blank\" rel=\"noopener\">查看网站 ↗</a><button id=\"logout\" class=\"quiet tiny-button\">退出登录</button><span>留住联系，也尊重选择。</span></div></aside><main>\n<header class=\"top\"><div><p class=\"eyebrow\">MUSEFILM / CREATOR'S DESK</p><h1 id=\"page-title\">把回音，好好收着。</h1></div><button class=\"quiet\" id=\"refresh\">刷新数据 ↻</button></header>\n<div class=\"stats\"><div class=\"stat\"><span>留下的邮箱</span><b id=\"stat-total\">—</b></div><div class=\"stat\"><span>已订阅</span><b id=\"stat-subscribed\">—</b></div><div class=\"stat\"><span>等待确认</span><b id=\"stat-pending\">—</b></div><div class=\"stat\"><span>已退订</span><b id=\"stat-unsubscribed\">—</b></div></div>\n<section data-view=\"subscribers\"><div class=\"section-head\"><div><h2>邮箱档案</h2><p>下载时自愿留下的联系，仅向已订阅用户发送更新。</p></div><a class=\"button quiet\" href=\"/api/admin/export\">导出 CSV ↓</a></div><form class=\"filters\" id=\"filters\"><input name=\"q\" aria-label=\"搜索邮箱\" placeholder=\"搜索邮箱…\"><select name=\"status\" aria-label=\"订阅状态\"><option value=\"\">全部状态</option><option value=\"contact\">仅留邮箱</option><option value=\"pending\">待确认订阅</option><option value=\"subscribed\">已订阅</option><option value=\"unsubscribed\">已退订</option></select><button type=\"submit\" class=\"quiet\">筛选</button></form><div class=\"table-shell\"><table><thead><tr><th>邮箱</th><th>订阅状态</th><th>感谢邮件</th><th>下载平台</th><th>最近下载</th><th>订阅时间</th><th>操作</th></tr></thead><tbody id=\"subscriber-rows\"></tbody></table></div><div class=\"pagination\"><span id=\"page-label\"></span><div class=\"actions\"><button class=\"quiet tiny-button\" id=\"previous\">上一页</button><button class=\"quiet tiny-button\" id=\"next\">下一页</button></div></div></section>\n<section data-view=\"campaigns\" hidden><div class=\"section-head\"><div><h2>寄出下一卷消息。</h2><p>写下版本更新与新闻，先预览、发测试邮件，再确认收件人数。</p></div><button class=\"quiet\" id=\"new-campaign\">新建来信 ＋</button></div><div class=\"notice\" id=\"mail-config\">正在读取邮件发送配置…</div><div class=\"compose-grid\"><form class=\"panel editor\" id=\"campaign-form\"><label>邮件标题<input name=\"subject\" required minlength=\"3\" maxlength=\"160\" placeholder=\"MuseFilm 有一卷新消息，想与你分享。\"></label><label>收件平台<select name=\"audience\"><option value=\"all\">全部已订阅用户</option><option value=\"windows\">Windows 用户</option><option value=\"mac\">macOS 用户</option></select></label><label>正文<textarea name=\"body\" rows=\"13\" required minlength=\"10\" maxlength=\"20000\" placeholder=\"你好，&#10;&#10;这一次，MuseFilm 更新了……&#10;&#10;愿每一卷光，都有值得停留的位置。\"></textarea></label><small>使用纯文本写作，空行分段。网站会自动排成 MuseFilm 风格的邮件，并加入退订入口。</small><div class=\"actions\"><button class=\"primary\" type=\"submit\">保存草稿 ↗</button><button class=\"quiet\" type=\"button\" id=\"preview-campaign\">预览</button></div><p class=\"message\" id=\"campaign-message\" role=\"status\"></p></form><div class=\"panel\"><div class=\"section-head\" style=\"margin:0\"><div><p class=\"eyebrow\">LETTER PREVIEW</p><p id=\"recipient-count\">先保存草稿，查看邮件效果。</p></div></div><iframe class=\"preview\" id=\"preview-frame\" title=\"邮件预览\" sandbox=\"\"></iframe><div class=\"actions\"><button class=\"quiet\" id=\"test-campaign\">发测试邮件给我</button><button class=\"primary\" id=\"send-campaign\">发送或预约 ↗</button></div><label style=\"display:grid;gap:10px;margin-top:18px;color:var(--muted);font-size:12px\">预约时间（本地时区；留空立即发送）<input type=\"datetime-local\" id=\"schedule-time\"></label><p class=\"progress\" id=\"campaign-progress\" role=\"status\"></p><div class=\"actions\"><button class=\"quiet tiny-button\" id=\"cancel-campaign\" hidden>取消预约</button><button class=\"quiet tiny-button\" id=\"retry-campaign\" hidden>重试可安全重发的失败地址</button><button class=\"quiet tiny-button\" id=\"refresh-progress\" hidden>更新投递记录 ↻</button></div><details class=\"delivery-panel\" id=\"delivery-details\" hidden><summary>投递明细与重试记录</summary><div class=\"table-shell\"><table><thead><tr><th>邮箱</th><th>状态</th><th>尝试 / 下次重试</th><th>结果代码</th></tr></thead><tbody id=\"delivery-rows\"></tbody></table></div><p class=\"detail\" id=\"attempt-summary\"></p></details></div></div><div class=\"section-head history\"><h2>来信记录</h2></div><div class=\"table-shell\" id=\"campaign-list\"></div></section>\n<section data-view=\"automation\" hidden><div class=\"section-head\"><div><h2>让下一卷消息，准时抵达。</h2><p>GitHub 新版本自动按 Windows / macOS 分组寄送，后台关闭后仍会运行。</p></div></div><div class=\"settings-grid\"><form class=\"panel editor\" id=\"automation-form\"><p class=\"eyebrow\">RELEASE LETTERS</p><h2>版本更新</h2><label class=\"toggle\"><input name=\"enabled\" type=\"checkbox\">检测到新版本后自动发送</label><label class=\"toggle\"><input name=\"includePrerelease\" type=\"checkbox\">也通知预览版本（Prerelease）</label><small>正式版本默认开启，草稿版本不发送。首次检查仅建立当前版本基线，不补发历史更新。暂停期间发布的版本不会在恢复后补发。</small><p class=\"detail\" id=\"automation-status\">读取状态中…</p><div class=\"actions\"><button class=\"primary\" type=\"submit\">保存设置 ↗</button><button class=\"quiet\" id=\"check-releases\" type=\"button\">立即检查版本</button></div></form><div class=\"panel editor\"><p class=\"eyebrow\">MAIL HEALTH</p><h2>退信与重试</h2><label class=\"toggle\"><input form=\"automation-form\" name=\"imapEnabled\" type=\"checkbox\">通过 QQ IMAP 自动处理退信</label><small>仅检查站长邮箱里的退信候选邮件，按原邮件编号和收件地址核对本站投递记录。读取不改变已读状态，不删除邮件。终止投递的退信会抑制后续发信；延迟报告只记录。</small><p class=\"detail\" id=\"imap-status\">读取状态中…</p><div class=\"actions\"><button class=\"quiet\" id=\"check-imap\">检查 IMAP 与退信</button></div><div class=\"notice\" style=\"margin:0\">临时失败最多自动尝试 4 次，间隔 5 分钟、30 分钟、2 小时。提交后状态不明的邮件标为待核实，避免重复寄送。<br>“已提交 SMTP”表示发送服务接受邮件，不代表已送达收件箱。</div></div></div><div class=\"section-head\"><div><h2>停止投递的地址</h2><p>解除抑制后，只恢复后续投递资格，不改变订阅状态，也不会补发历史邮件。</p></div></div><div class=\"table-shell\"><table><thead><tr><th>邮箱</th><th>原因 / 来源</th><th>时间</th><th>操作</th></tr></thead><tbody id=\"suppression-rows\"></tbody></table></div><div class=\"section-head\"><div><h2>退信记录</h2><p>最近 100 条与本站邮件匹配的报告；不支持的退信格式仍需到站长邮箱核实。</p></div></div><div class=\"table-shell\"><table><thead><tr><th>时间</th><th>邮箱 / 来信</th><th>类型</th><th>原因</th></tr></thead><tbody id=\"bounce-rows\"></tbody></table></div></section>\n<section data-view=\"downloads\" hidden><div class=\"section-head\"><div><h2>下载的回声。</h2><p>最近 100 条网站下载点击；IP 位置是推测值，点击不代表已完成下载。</p></div></div><div class=\"table-shell\"><table><thead><tr><th>时间</th><th>安装包</th><th>IP / 地区</th><th>设备</th><th>提醒状态</th></tr></thead><tbody id=\"download-rows\"></tbody></table></div></section>\n</main></div><div id=\"toast\" role=\"status\" hidden></div>\n<dialog id=\"send-confirm\"><h2>寄给愿意听见的人。</h2><p id=\"send-summary\"></p><label>输入本次收件人数，确认发送或预约<input id=\"confirm-count\" inputmode=\"numeric\" placeholder=\"收件人数\"></label><p style=\"font-size:12px\">按确认时的收件名单发送；之后退订或被抑制的地址会跳过。新订阅者不会加入本次预约。开始发送后无法撤回。</p><div class=\"actions\"><button class=\"quiet\" id=\"cancel-send\">再检查一下</button><button class=\"primary\" id=\"confirm-send\">开始发送 ↗</button></div></dialog>\n<dialog id=\"restore-confirm\"><h2>恢复后续投递资格</h2><p id=\"restore-summary\"></p><label>再次输入邮箱以解除抑制<input id=\"restore-email\" type=\"email\"></label><div class=\"actions\"><button class=\"quiet\" id=\"cancel-restore\">取消</button><button class=\"primary\" id=\"confirm-restore\">解除抑制</button></div></dialog>\n<script>\nconst $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];let restoreEmail='',progressTimer;let currentTab='subscribers',page=1,total=0,challengeId='',campaignId='',recipientCount=0,campaigns=[],sending=false;\nconst labels={queued:'待发送',suppressed:'已抑制',contact:'仅留邮箱',pending:'待确认订阅',subscribed:'已订阅',unsubscribed:'已退订',draft:'草稿',sending:'发送中',sent:'已提交 SMTP',failed:'失败',partial_failure:'部分发送失败',not_configured:'未配置',skipped:'已跳过',scheduled:'已预约',cancelled:'已取消',retry_wait:'等待重试',uncertain:'待核实',bounced:'已退信'};\nconst esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));const date=s=>s?new Date(s).toLocaleString('zh-CN',{hour12:false}):'—';const badge=s=>`<span class=\"badge ${esc(s)}\">${esc(labels[s]||s||'—')}</span>`;\nlet toastTimeout;function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('#toast').hidden=true,6500)}\nasync function api(path,options={}){const response=await fetch(path,{cache:'no-store',credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});const data=await response.json();if(response.status===401){$('#dashboard').hidden=true;$('#login').hidden=false;throw Error('请重新登录。')}if(!response.ok||!data.ok)throw Error(data.error||'请求失败，请重试。');return data}\nconst post=(path,body={})=>api(path,{method:'POST',body:JSON.stringify(body)});\nasync function loadSubscribers(){const form=new FormData($('#filters')),query=new URLSearchParams({q:form.get('q'),status:form.get('status'),page});const data=await api('/api/admin/subscribers?'+query);total=data.total;for(const key of ['total','subscribed','pending','unsubscribed'])$('#stat-'+key).textContent=Number(data.stats?.[key]||0).toLocaleString();$('#subscriber-rows').innerHTML=data.subscribers.length?data.subscribers.map(row=>`<tr><td>${esc(row.email)}<small>${esc(row.locale)} · 留于 ${esc(date(row.created_at))}</small></td><td>${badge(row.status)}${row.suppression_reason?'<small>退信抑制中</small>':''}</td><td>${badge(row.thank_you_status)}</td><td>${esc(row.platforms?.split(',').map(p=>p==='mac'?'macOS':'Windows').join(' / ')||row.platform||'—')}</td><td>${esc(date(row.last_download_at))}</td><td>${esc(date(row.confirmed_at))}</td><td>${row.status!=='unsubscribed'?`<button class=\"quiet tiny-button\" data-unsubscribe=\"${esc(row.id)}\">停止发信</button>`:'—'}</td></tr>`).join(''):'<tr><td colspan=\"7\" class=\"empty\">还没有符合条件的邮箱。每一次自愿留下，都会保存在这里。</td></tr>';$('#page-label').textContent=`共 ${total} 条 · 第 ${page} / ${Math.max(1,Math.ceil(total/50))} 页`;$('#previous').disabled=page<=1;$('#next').disabled=page*50>=total}\nasync function loadCampaigns(){const data=await api('/api/admin/campaigns');campaigns=data.campaigns;$('#campaign-list').innerHTML=campaigns.length?campaigns.map(row=>`<div class=\"campaign-item\"><div><strong>${esc(row.subject)}</strong><p>${esc(date(row.updated_at))} · ${row.kind==='release'?'自动版本更新':row.test_status==='sent'?'已发测试邮件':'尚未发测试邮件'} · ${esc({all:'全部平台',mac:'macOS',windows:'Windows'}[row.audience])}${row.scheduled_at?' · '+esc(date(row.scheduled_at)):''}</p></div><div class=\"actions\">${badge(row.status)}<button class=\"quiet tiny-button\" data-load-campaign=\"${esc(row.id)}\">查看</button></div></div>`).join(''):'<div class=\"empty\">第一封来信，还在等待你写下。</div>'}\nasync function loadDownloads(){const data=await api('/api/admin/downloads');$('#download-rows').innerHTML=data.downloads.length?data.downloads.map(row=>`<tr><td>${esc(date(row.created_at))}</td><td>${esc(row.asset_name)}<small>${esc(row.contact_email||'未分享邮箱')}</small></td><td>${esc(row.ip_address)}<small>${esc([row.country,row.region,row.city].filter(Boolean).join(' / '))}</small></td><td>${esc(row.operating_system)} / ${esc(row.browser)}</td><td>${badge(row.email_status)}</td></tr>`).join(''):'<tr><td class=\"empty\" colspan=\"5\">暂时没有下载点击记录。</td></tr>'}\nasync function refresh(){await loadSubscribers();if(currentTab==='campaigns')await loadCampaigns();if(currentTab==='downloads')await loadDownloads();if(currentTab==='automation')await loadAutomation()}\nasync function enter(){await api('/api/admin/session');$('#login').hidden=true;$('#dashboard').hidden=false;await refresh();const config=await api('/api/admin/mail-config');$('#mail-config').textContent=config.ready?'QQ 邮箱 SMTP 已配置。先发送测试邮件，确认排版和投递情况。':'QQ 邮箱 SMTP 尚未配置。邮箱与订阅同意记录可以正常保存；请先在 Cloudflare 设置 SMTP_USER 与 SMTP_PASSWORD，再发测试邮件。'}\n$('#request-code').onclick=async()=>{const button=$('#request-code');button.disabled=true;try{const data=await post('/api/admin/login/request');challengeId=data.challengeId;$('#login-message').textContent='验证码已发送至站长邮箱，10 分钟内有效。';$('#login-form').elements.code.focus()}catch(e){$('#login-message').textContent=e.message}finally{button.disabled=false}};\n$('#login-form').onsubmit=async event=>{event.preventDefault();if(!challengeId){$('#login-message').textContent='请先发送登录验证码。';return}$('#login-submit').disabled=true;try{await post('/api/admin/login',{challengeId,code:$('#login-form').elements.code.value.trim()});$('#login-form').reset();await enter()}catch(e){$('#login-message').textContent=e.message}finally{$('#login-submit').disabled=false}};\n$('#logout').onclick=async()=>{try{await post('/api/admin/logout');location.reload()}catch(e){toast(e.message)}};\nall('[data-tab]').forEach(button=>button.onclick=async()=>{currentTab=button.dataset.tab;all('[data-tab]').forEach(el=>el.classList.toggle('active',el===button));all('[data-view]').forEach(el=>el.hidden=el.dataset.view!==currentTab);$('#page-title').textContent={subscribers:'把回音，好好收着。',campaigns:'把下一卷消息，寄出去。',downloads:'每一次抵达，都有回声。',automation:'把时间，交给下一卷消息。'}[currentTab];try{await refresh()}catch(e){toast(e.message)}});\n$('#refresh').onclick=()=>refresh().catch(e=>toast(e.message));$('#filters').onsubmit=event=>{event.preventDefault();page=1;loadSubscribers().catch(e=>toast(e.message))};$('#previous').onclick=()=>{page--;loadSubscribers().catch(e=>toast(e.message))};$('#next').onclick=()=>{page++;loadSubscribers().catch(e=>toast(e.message))};\n$('#subscriber-rows').onclick=async event=>{const button=event.target.closest('[data-unsubscribe]');if(!button)return;button.disabled=true;try{await api('/api/admin/subscribers/'+button.dataset.unsubscribe,{method:'PATCH',body:JSON.stringify({action:'unsubscribe'})});await loadSubscribers();toast('已停止向该邮箱发送后续邮件。')}catch(e){toast(e.message);button.disabled=false}};\nasync function preview(){if(!campaignId)throw Error('请先保存草稿。');const data=await api('/api/admin/campaigns/'+campaignId+'/preview');recipientCount=data.recipientCount;$('#preview-frame').srcdoc=data.html;$('#recipient-count').textContent=`本次可发送给 ${recipientCount} 位已订阅用户`;for(const key of ['subject','body','audience'])$('#campaign-form').elements[key].disabled=data.campaign.status!=='draft';$('#schedule-time').disabled=data.campaign.status!=='draft';$('#schedule-time').value=data.campaign.scheduled_at?localInput(data.campaign.scheduled_at):$('#schedule-time').value;$('#cancel-campaign').hidden=!['scheduled','queued'].includes(data.campaign.status);$('#retry-campaign').hidden=!['partial_failure','sending','retry_wait'].includes(data.campaign.status);$('#refresh-progress').hidden=data.campaign.status==='draft';$('#send-campaign').disabled=data.campaign.status!=='draft'||!recipientCount||data.campaign.test_status!=='sent';$('#test-campaign').disabled=data.campaign.status!=='draft';return data}\n$('#campaign-form').onsubmit=async event=>{event.preventDefault();const form=$('#campaign-form');try{const data=await api('/api/admin/campaigns'+(campaignId?'/'+campaignId:''),{method:campaignId?'PATCH':'POST',body:JSON.stringify({subject:form.elements.subject.value,body:form.elements.body.value,audience:form.elements.audience.value})});campaignId=data.id;$('#campaign-message').textContent='草稿已保存。先预览并发送测试邮件。';await preview();await loadCampaigns()}catch(e){$('#campaign-message').textContent=e.message}};\n$('#preview-campaign').onclick=()=>preview().catch(e=>toast(e.message));$('#new-campaign').onclick=()=>{campaignId='';clearTimeout(progressTimer);$('#campaign-form').reset();$('#schedule-time').value='';$('#schedule-time').disabled=false;$('#delivery-details').hidden=true;$('#cancel-campaign').hidden=true;$('#retry-campaign').hidden=true;$('#refresh-progress').hidden=true;$('#preview-frame').srcdoc='';$('#recipient-count').textContent='先保存草稿，查看邮件效果。';$('#campaign-message').textContent='';$('#campaign-progress').textContent='';$('#send-campaign').disabled=true;$('#campaign-form').elements.subject.focus()};\n$('#test-campaign').onclick=async()=>{if(!campaignId){toast('请先保存草稿。');return}$('#test-campaign').disabled=true;try{await post('/api/admin/campaigns/'+campaignId+'/test');toast('测试邮件已发送至站长邮箱，请检查后再发送。');await preview();await loadCampaigns()}catch(e){toast(e.message)}finally{$('#test-campaign').disabled=false}};\n$('#send-campaign').onclick=async()=>{try{const data=await preview();if(data.campaign.test_status!=='sent')throw Error('请先发送测试邮件。');$('#send-summary').textContent=`「${data.campaign.subject}」将${$('#schedule-time').value?'于 '+date(new Date($('#schedule-time').value).toISOString())+' 预约发送':'立即发送'}给 ${recipientCount} 位${{all:'全部平台',mac:'macOS',windows:'Windows'}[data.campaign.audience]}已订阅用户。`;$('#confirm-count').value='';$('#send-confirm').showModal()}catch(e){toast(e.message)}};$('#cancel-send').onclick=()=>$('#send-confirm').close();\nfunction localInput(value){const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}\nfunction progressText(p){return `已提交 SMTP ${p.sent||0} · 待发送 ${p.pending||0} · 发送中 ${p.sending||0} · 等待重试 ${p.retry_wait||0} · 失败 ${p.failed||0} · 退信 ${p.bounced||0} · 待核实 ${p.uncertain||0} · 已跳过 ${p.skipped||0}`}\nasync function process(){if(!campaignId)return;const requestedId=campaignId;const data=await api('/api/admin/campaigns/'+requestedId+'/progress');if(requestedId!==campaignId)return;$('#cancel-campaign').hidden=!['scheduled','queued'].includes(data.campaign.status);$('#retry-campaign').hidden=!['partial_failure','sending','retry_wait'].includes(data.campaign.status);$('#campaign-progress').textContent=progressText(data.progress);$('#delivery-details').hidden=false;$('#refresh-progress').hidden=false;$('#delivery-rows').innerHTML=data.recipients.map(r=>`<tr><td>${esc(r.email)}</td><td>${badge(r.status)}</td><td>${Number(r.attempts||0)} 次${r.next_attempt_at?'<small>'+esc(date(r.next_attempt_at))+'</small>':''}</td><td>${esc(r.error_code||'—')}<small>${esc(r.last_stage||'')}</small></td></tr>`).join('')||'<tr><td colspan=\"4\" class=\"empty\">尚未建立投递名单。</td></tr>';$('#attempt-summary').textContent=data.attempts.slice(0,8).map(a=>`${date(a.created_at)} · ${a.email} · 第 ${a.attempt} 次 · ${labels[a.status]||a.status}${a.error_code?' / '+a.error_code:''}`).join('；');clearTimeout(progressTimer);if(currentTab==='campaigns' && (data.progress.pending||data.progress.sending||data.progress.retry_wait))progressTimer=setTimeout(()=>process().catch(e=>toast(e.message)),15000);await loadCampaigns()}\n$('#confirm-send').onclick=async()=>{if(Number($('#confirm-count').value)!==recipientCount){toast('请输入正确的收件人数。');return}$('#confirm-send').disabled=true;try{const data=await post('/api/admin/campaigns/'+campaignId+'/start',{confirmRecipientCount:recipientCount,scheduledAt:$('#schedule-time').value?new Date($('#schedule-time').value).toISOString():null});$('#send-confirm').close();$('#campaign-message').textContent=data.status==='scheduled'?'预约已保存，服务器会到时发送。':'已加入服务器发送队列。';toast(data.status==='scheduled'?'预约已保存，服务器会到时发送。':'已加入发送队列，关闭后台也会继续。');await preview();await process()}catch(e){toast(e.message)}finally{$('#confirm-send').disabled=false}};\n$('#refresh-progress').onclick=()=>process().catch(e=>toast(e.message));$('#cancel-campaign').onclick=async()=>{try{await post('/api/admin/campaigns/'+campaignId+'/cancel');toast('已取消本次预约。');await preview();await process()}catch(e){toast(e.message)}};$('#retry-campaign').onclick=async()=>{try{const data=await post('/api/admin/campaigns/'+campaignId+'/retry');toast(`已安排 ${data.retried} 个失败地址重试。`);await process()}catch(e){toast(e.message)}};\n$('#campaign-list').onclick=async event=>{const button=event.target.closest('[data-load-campaign]');if(!button)return;const campaign=campaigns.find(c=>c.id===button.dataset.loadCampaign);campaignId=campaign.id;$('#campaign-form').elements.subject.value=campaign.subject;$('#campaign-form').elements.body.value=campaign.body;$('#campaign-form').elements.audience.value=campaign.audience;$('#campaign-form').elements.audience.disabled=campaign.status!=='draft';$('#schedule-time').value=campaign.scheduled_at?localInput(campaign.scheduled_at):'';$('#campaign-form').elements.subject.disabled=campaign.status!=='draft';$('#campaign-form').elements.body.disabled=campaign.status!=='draft';try{await preview();if(campaign.status!=='draft')await process()}catch(e){toast(e.message)}};\n$('#new-campaign').addEventListener('click',()=>{$('#campaign-form').elements.subject.disabled=false;$('#campaign-form').elements.body.disabled=false;$('#campaign-form').elements.audience.disabled=false});$('#send-campaign').disabled=true;\nasync function loadAutomation(){const data=await api('/api/admin/automation'),s=data.settings,form=$('#automation-form');form.elements.enabled.checked=Boolean(s.enabled);form.elements.includePrerelease.checked=Boolean(s.include_prerelease);form.elements.imapEnabled.checked=Boolean(s.imap_enabled);$('#automation-status').textContent=`当前分组：${data.groups.map(g=>(g.platform==='mac'?'macOS':'Windows')+' '+g.count+' 人').join(' · ')||'暂无已订阅用户'}。基线：${date(s.baseline_at)}。最近版本检查：${date(s.last_scan_at)}${s.scan_error?' / '+s.scan_error:''}。服务器最近运行：${date(s.last_tick_at)}。发布事件触发即时检查，每 5 分钟轮询兜底。`;\n$('#imap-status').textContent=`最近检查：${date(s.imap_last_at)} · ${s.imap_error?s.imap_error:s.imap_last_at?'连接正常':'尚未验证连接'} · 已检查候选 ${s.imap_checked} 封。每约 5 分钟检查一次。`;const b=await api('/api/admin/bounces');$('#suppression-rows').innerHTML=b.suppressed.map(r=>`<tr><td>${esc(r.email)}</td><td>${esc(r.reason)} / ${esc(r.source)}</td><td>${esc(date(r.created_at))}</td><td><button class=\"quiet tiny-button\" data-restore=\"${esc(r.email)}\">解除抑制</button></td></tr>`).join('')||'<tr><td colspan=\"4\" class=\"empty\">目前没有被抑制的地址。</td></tr>';$('#bounce-rows').innerHTML=b.bounces.map(r=>`<tr><td>${esc(date(r.created_at))}</td><td>${esc(r.email)}<small>${esc(r.subject||'')}</small></td><td>${r.kind==='hard'?'终止投递':'投递延迟'}</td><td>${esc(r.diagnostic)}</td></tr>`).join('')||'<tr><td colspan=\"4\" class=\"empty\">目前没有匹配到退信。</td></tr>'}\n$('#automation-form').onsubmit=async event=>{event.preventDefault();const f=event.currentTarget;try{await api('/api/admin/automation',{method:'PATCH',body:JSON.stringify({enabled:f.elements.enabled.checked,includePrerelease:f.elements.includePrerelease.checked,imapEnabled:f.elements.imapEnabled.checked})});toast('自动寄信设置已保存。');await loadAutomation()}catch(e){toast(e.message)}};\nfor(const [selector,path,success] of [['#check-releases','check','版本检查完成。'],['#check-imap','imap','IMAP 连接正常，退信检查完成。']])$(selector).onclick=async()=>{const button=$(selector);button.disabled=true;try{const r=await post('/api/admin/automation/'+path);toast(r.busy?'已有检查正在运行，请稍后刷新。':r.baseline?'已建立版本基线，没有发送历史更新。':success);await loadAutomation()}catch(e){toast(e.message);await loadAutomation()}finally{button.disabled=false}};\n$('#suppression-rows').onclick=event=>{const b=event.target.closest('[data-restore]');if(!b)return;restoreEmail=b.dataset.restore;$('#restore-summary').textContent=restoreEmail+' 将恢复后续投递资格，请先核实退信原因已解决。';$('#restore-email').value='';$('#restore-confirm').showModal()};$('#cancel-restore').onclick=()=>$('#restore-confirm').close();$('#confirm-restore').onclick=async()=>{try{await post('/api/admin/bounces/restore',{email:restoreEmail,confirmEmail:$('#restore-email').value.trim().toLowerCase()});$('#restore-confirm').close();await loadAutomation();toast('已解除抑制，订阅状态保持原样。')}catch(e){toast(e.message)}};\nenter().catch(()=>{});\n</script></body></html>\n";
// Embedded in worker.js by scripts/bundle-community.mjs for dashboard deployment.
const CONSENT_VERSION = "2026-10-20"; // Legacy checkbox flow, retained for cached clients.
const DIRECT_CONSENT_VERSION = "2026-10-20-email-subscription-v2";
const COMMUNITY_ORIGIN = "https://musefilm-feedback-api.syrquartz.workers.dev";

function communityMailReady(env) {
  return Boolean(env.SMTP_PASSWORD && validEmail(env.SMTP_USER || env.FEEDBACK_TO_EMAIL) || env.SUBSCRIBER_EMAIL);
}

function smtpMime(message, user) {
  const encode = value => btoa(String.fromCharCode(...new TextEncoder().encode(String(value || ""))));
  const wrap = value => encode(value).match(/.{1,76}/g)?.join("\r\n") || "";
  const boundary = "musefilm-"+crypto.randomUUID();
  if (!validEmail(message.to) || !validEmail(user)) throw Object.assign(new Error("Invalid recipient"),{code:"SMTP_INVALID_ADDRESS"});
  const headers = ["From: MuseFilm <"+user+">","To: <"+message.to+">","Subject: =?UTF-8?B?"+encode(String(message.subject || "").replace(/[\r\n]/g," "))+"?=","Date: "+new Date().toUTCString(),"Message-ID: <"+(/^[a-z0-9-]+@musefilm\.top$/.test(message.messageId || "") ? message.messageId : crypto.randomUUID()+"@musefilm.top")+">","MIME-Version: 1.0"];
  if (validEmail(message.replyTo)) headers.push("Reply-To: <"+message.replyTo+">");
  headers.push('Content-Type: multipart/alternative; boundary="'+boundary+'"');
  return headers.join("\r\n")+"\r\n\r\n--"+boundary+"\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"+wrap(message.text)+"\r\n--"+boundary+"\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"+wrap(message.html)+"\r\n--"+boundary+"--\r\n";
}

async function sendQqSmtp(env,message,connectOverride) {
  const user=env.SMTP_USER || env.FEEDBACK_TO_EMAIL;
  if(!env.SMTP_PASSWORD || !validEmail(user)) throw Object.assign(new Error("QQ SMTP not configured"),{code:"SMTP_NOT_CONFIGURED"});
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
    stage="data_ack";bodySubmitted=true;await command(smtpMime(message,user).replace(/(^|\r\n)\./g,"$1..")+"\r\n.",250);
    // Successful DATA acknowledgement is the delivery boundary; QUIT is best effort.
    socket.write("QUIT\r\n");return {accepted:true};
  } catch(error) {error.stage=stage;error.uncertain=bodySubmitted && !/^SMTP_\d{3}$/.test(error.code || "");throw error}
  finally {clearTimeout(deadline);socket.end();socket.destroy()}
}

async function sendCommunityMail(env,message) {
  if(env.SMTP_PASSWORD) return sendQqSmtp(env,message);
  if(env.SUBSCRIBER_EMAIL) return env.SUBSCRIBER_EMAIL.send(message);
  throw Object.assign(new Error("QQ SMTP not configured"),{code:"SMTP_NOT_CONFIGURED"});
}

function communityHtml(content, title = "MuseFilm") {
  return new Response(content, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'self' about:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
}

function communityMessage(title, body, action = "") {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · MuseFilm</title><style>html{color-scheme:dark}body{margin:0;padding:12vh 24px;background:#080808;color:#f2efe8;font:16px/1.8 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}main{max-width:520px;margin:auto;padding:36px;border:1px solid #39332f;border-radius:24px;background:radial-gradient(at top right,#35201e,transparent 65%),#131312}small{color:#d05248;letter-spacing:.15em}h1{font-size:32px;line-height:1.2;letter-spacing:-.05em}p{color:#aaa59e}button,a.button{display:inline-block;border:1px solid #d05248;border-radius:99px;padding:12px 20px;color:#fff;background:#963e36;text-decoration:none;cursor:pointer;font:inherit}a{color:#d2b297}</style><main><small>MUSEFILM · KEEP THE LIGHT</small><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${action}<p><a href="https://musefilm.top/">回到 MuseFilm ↗</a></p></main></html>`;
}

function subscriberEmailHtml(title, paragraphs, action, footer) {
  return `<!doctype html><html lang="zh-CN"><body style="margin:0;padding:32px 16px;background:#090909;color:#f2efe8;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',Arial,sans-serif"><table role="presentation" style="width:100%;max-width:600px;margin:auto;border:1px solid #38322e;border-radius:22px;background:#151413;border-collapse:separate"><tr><td style="padding:32px"><div style="color:#d4b69a;font-size:12px;letter-spacing:.16em">MUSEFILM · A LETTER FROM THE DARKROOM</div><h1 style="font-size:32px;font-weight:600;line-height:1.3;letter-spacing:-.04em;color:#f2efe8">${escapeHtml(title)}</h1>${paragraphs.map(p => `<p style="color:#c4bfb7;font-size:15px;line-height:1.9;white-space:pre-wrap">${escapeHtml(p)}</p>`).join("")}${action}<hr style="border:0;border-top:1px solid #37312d;margin:28px 0"><div style="font-size:11px;color:#928b81;line-height:1.8">${footer}</div></td></tr></table></body></html>`;
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

async function adminSubscribers(request,env) {
  const url = new URL(request.url);
  const q = cleanText(url.searchParams.get("q"),160);
  const status = cleanText(url.searchParams.get("status"),20);
  const page = Math.max(1,Math.min(100000,Number(url.searchParams.get("page")) || 1));
  const values = [`%${q}%`,status,status];
  const where = "WHERE email LIKE ? AND (?='' OR status=?)";
  const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM subscribers ${where}`).bind(...values).first();
  const rows = await env.DB.prepare(`SELECT id,email,status,locale,platform,(SELECT GROUP_CONCAT(platform) FROM subscriber_platforms WHERE subscriber_id=subscribers.id) AS platforms,(SELECT reason FROM mail_suppressions WHERE email=subscribers.email) AS suppression_reason,consent_at,confirmed_at,created_at,last_download_at,(SELECT status FROM subscriber_mail_log WHERE subscriber_id=subscribers.id ORDER BY created_at DESC LIMIT 1) AS thank_you_status FROM subscribers ${where} ORDER BY created_at DESC LIMIT 50 OFFSET ?`).bind(...values,(page-1)*50).all();
  const stats = await env.DB.prepare("SELECT COUNT(*) AS total,SUM(status='subscribed') AS subscribed,SUM(status='pending') AS pending,SUM(status='contact') AS contact,SUM(status='unsubscribed') AS unsubscribed FROM subscribers").first();
  return json({ok:true,subscribers:rows.results || [],total:Number(count?.count || 0),page,stats});
}

function campaignContent(campaign,subscriber) {
  const unsubscribe = subscriberLinks(subscriber).unsubscribe;
  return { subject:campaign.subject,html:subscriberEmailHtml(campaign.subject,campaign.body.split(/\n\s*\n/),emailButton(campaign.release_url || "https://musefilm.top/#download",campaign.kind==="release" ? "查看新版本与下载" : "打开 MuseFilm"),`你已订阅 MuseFilm 的版本更新与新闻。<br><a href="${escapeHtml(unsubscribe)}" style="color:#bd9d85">退订后续邮件</a> · musefilm.top`),text:campaign.subject+"\n\n"+campaign.body+`\n\n下载：https://musefilm.top/#download\n退订：${unsubscribe}` };
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
  if (path === "/admin" || path === "/admin/") return communityHtml(ADMIN_PAGE_HTML);
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
  if (path === "/api/admin/session") return json({ok:true});
  if (path === "/api/admin/mail-config") return json({ok:true,ready:communityMailReady(env),provider:env.SMTP_PASSWORD ? "qq_smtp" : env.SUBSCRIBER_EMAIL ? "cloudflare" : "not_configured"});
  if (path === "/api/admin/logout" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha256(cookieValue(request,"musefilm_admin"))).run();
    return json({ok:true},200,{"Set-Cookie":"musefilm_admin=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0"});
  }
  if (path === "/api/admin/subscribers" && request.method === "GET") return adminSubscribers(request,env);
  if (path === "/api/admin/export" && request.method === "GET") {
    const rows=await env.DB.prepare("SELECT email,status,locale,platform,consent_at,confirmed_at,created_at,last_download_at FROM subscribers ORDER BY created_at DESC").all();
    const columns=["email","status","locale","platform","consent_at","confirmed_at","created_at","last_download_at"];
    return new Response("\ufeff"+[columns.map(csvCell).join(","),...(rows.results || []).map(row=>columns.map(k=>csvCell(row[k])).join(","))].join("\r\n"),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=musefilm-subscribers.csv","Cache-Control":"no-store"}});
  }
  const subscriberMatch=path.match(/^\/api\/admin\/subscribers\/([^/]+)$/);
  if(subscriberMatch && request.method === "PATCH") {
    const body=await readJson(request,1024);
    if(body.action!=="unsubscribe") return json({ok:false,error:"invalid_action"},400);
    await env.DB.prepare("UPDATE subscribers SET status='unsubscribed' WHERE id=?").bind(subscriberMatch[1]).run();
    return json({ok:true});
  }
  return handleMailAdmin(request,env,ctx);
}

// Embedded with community.js. All times are UTC ISO strings; the admin converts local input.
const RELEASE_FEED = "https://api.github.com/repos/Quartzsyr/MuseFilm/releases?per_page=100";
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
  if(!active) await env.DB.prepare("UPDATE campaigns SET status=?,updated_at=? WHERE id=? AND status IN ('sending','queued','retry_wait','sent')").bind(p.failed || p.bounced || p.uncertain ? 'partial_failure':'sent',isoNow(),id).run();
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
    if(subscriber) {
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
async function scanReleases(env,force=false,fetcher=fetch) {
  const release=await mailLock(env,'release-scan');if(!release)return {busy:true};
  try {
    const settings=await env.DB.prepare("SELECT * FROM mail_settings WHERE id=1").first();
    if(!force && settings.scan_due>isoNow())return {skipped:true};
    const response=await fetcher(RELEASE_FEED,{headers:{'User-Agent':'MuseFilm-release-mail','Accept':'application/vnd.github+json',...(settings.etag?{'If-None-Match':settings.etag}:{})},signal:AbortSignal.timeout(12000)});
    const now=isoNow(),due=new Date(Date.now()+5*60000).toISOString();
    if(response.status===304) {
      await env.DB.prepare("UPDATE mail_settings SET last_scan_at=?,scan_due=?,scan_error='' WHERE id=1").bind(now,due).run();return {unchanged:true};
    }
    if(!response.ok)throw Object.assign(new Error('Release source unavailable'),{code:'GITHUB_'+response.status});
    const text=await response.text();if(text.length>2000000)throw Object.assign(new Error('Release feed too large'),{code:'GITHUB_FEED_TOO_LARGE'});
    const releases=JSON.parse(text);if(!Array.isArray(releases))throw new Error('GITHUB_BAD_FEED');
    // Record all preview/stable variants even when preview mail is disabled, so toggling it never backfills old mail.
    const variants=releaseVariants(releases,true),existing=await env.DB.prepare("SELECT source_key FROM mail_releases").all(),seen=new Set((existing.results||[]).map(r=>r.source_key));
    let created=0;const statements=[];
    for(const item of variants) {
      if(seen.has(item.key))continue;
      const shouldSend=Boolean(settings.baseline_at && settings.enabled && (!item.preview || settings.include_prerelease) && (Date.parse(item.published)>=Date.parse(settings.baseline_at) || !item.preview && seen.has(item.key.replace(':stable',':preview'))));
      const id=shouldSend?crypto.randomUUID():'';
      // A single D1 transaction creates the dedupe marker, campaign and audience snapshot.
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO mail_releases(source_key,campaign_id,discovered_at) VALUES(?,?,?)").bind(item.key,id,now));
      if(!shouldSend)continue;
      const label=item.platform==='mac'?'macOS':'Windows',subject=`MuseFilm ${label} ${item.title}${item.preview?' · 预览版':''} 已发布`;
      const body=`你订阅的 MuseFilm ${label} 有新版本了。\n\n${item.notes}\n\n查看本次版本与安装包：\n${item.url}\n\n感谢你一直陪着 MuseFilm 留住每一卷光。`;
      statements.push(env.DB.prepare("INSERT INTO campaigns(id,subject,body,status,test_status,created_at,updated_at) VALUES(?,?,?,'queued','automatic',?,?)").bind(id,subject,body,now,now));
      statements.push(env.DB.prepare("INSERT INTO campaign_options(campaign_id,audience,kind,scheduled_at,source_key,release_url) VALUES(?,?,'release',?,?,?)").bind(id,item.platform,now,item.key,item.url));
      statements.push(env.DB.prepare(`INSERT INTO campaign_recipients(campaign_id,subscriber_id) SELECT ?,s.id FROM subscribers s WHERE ${audienceWhere}`).bind(id,item.platform,item.platform));created++;
    }
    statements.push(env.DB.prepare("UPDATE mail_settings SET baseline_at=COALESCE(baseline_at,?),last_scan_at=?,scan_due=?,scan_error='',etag=? WHERE id=1").bind(now,now,due,cleanText(response.headers.get('ETag'),160)));
    // GitHub feed is bounded to 100 releases; D1 batches stay below the statement limit.
    if(statements.length>450)throw Object.assign(new Error('Too many new releases'),{code:'RELEASE_BATCH_TOO_LARGE'});
    await env.DB.batch(statements);
    return {baseline:!settings.baseline_at,created};
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
  if(header.alg!=='RS256' || !header.kid || claims.iss!=='https://token.actions.githubusercontent.com' || claims.aud!==RELEASE_AUDIENCE || !Number.isFinite(claims.exp) || claims.exp<now || !Number.isFinite(claims.iat) || claims.iat>now+30 || now-claims.iat>600 || !Number.isFinite(claims.nbf) || claims.nbf>now+30 || String(claims.repository_id)!=='1158598100' || claims.repository!=='Quartzsyr/MuseFilm' || !['release','workflow_dispatch'].includes(claims.event_name) || !/^Quartzsyr\/MuseFilm\/\.github\/workflows\/notify-release-subscribers\.yml@refs\/(heads\/main|tags\/.+)$/.test(claims.workflow_ref || ''))throw new Error('INVALID_RELEASE_TOKEN');
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
    const s=await env.DB.prepare('SELECT * FROM mail_settings WHERE id=1').first();if(!s.imap_enabled || !force && s.imap_due>isoNow())return {skipped:true};
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
  await dispatchMail(env);
}

async function handleReleaseCheck(request,env,ctx) {
  if(new URL(request.url).pathname!=='/api/releases/check')return null;
  if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  try {await verifyReleaseToken((request.headers.get('Authorization') || '').replace(/^Bearer /,''))}catch{return json({ok:false,error:'invalid_release_identity'},401)}
  const result=await scanReleases(env,true);
  if(ctx?.waitUntil)ctx.waitUntil(dispatchMail(env));
  return json({ok:!result.error,...result},result.error?503:200);
}
async function handleMailAdmin(request,env,ctx) {
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/admin/automation') {
    if(request.method==='PATCH') {
      const b=await readJson(request,2048);
      if(typeof b.enabled!=='boolean' || typeof b.includePrerelease!=='boolean' || typeof b.imapEnabled!=='boolean')return json({ok:false,error:'invalid_settings'},400);
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
    if(subject.length<3 || text.length<10 || !['all','windows','mac'].includes(audience))return json({ok:false,error:'请填写标题、正文（至少 10 字）和收件平台。'},400);
    const id=match?match[1]:crypto.randomUUID(),now=isoNow();
    if(match) {
      const result=await env.DB.prepare("UPDATE campaigns SET subject=?,body=?,test_status='',tested_at=NULL,updated_at=? WHERE id=? AND status='draft'").bind(subject,text,now,id).run();
      if(!Number(result.meta?.changes))return json({ok:false,error:'只有草稿可以修改。'},409);
    } else await env.DB.prepare('INSERT INTO campaigns(id,subject,body,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,subject,text,now,now).run();
    await env.DB.prepare("INSERT INTO campaign_options(campaign_id,audience) VALUES(?,?) ON CONFLICT(campaign_id) DO UPDATE SET audience=excluded.audience").bind(id,audience).run();
    return json({ok:true,id});
  }
  if(!match)return null;
  const campaign=await env.DB.prepare(campaignSelect+' WHERE c.id=?').bind(match[1]).first();if(!campaign)return json({ok:false,error:'not_found'},404);
  const action=match[2];
  if(action==='preview')return json({ok:true,campaign,html:campaignContent(campaign,{unsubscribe_token:'preview',confirmation_token:'preview'}).html,recipientCount:await recipientCount(env,campaign.audience)});
  if(action==='progress') {
    const recipients=await env.DB.prepare("SELECT s.email,r.status,r.error_code,r.sent_at,d.attempts,d.next_attempt_at,d.last_stage FROM campaign_recipients r JOIN subscribers s ON s.id=r.subscriber_id LEFT JOIN mail_delivery d ON d.campaign_id=r.campaign_id AND d.subscriber_id=r.subscriber_id WHERE r.campaign_id=? ORDER BY r.status,s.email LIMIT 100").bind(campaign.id).all();
    const attempts=await env.DB.prepare('SELECT a.*,s.email FROM mail_attempts a JOIN subscribers s ON s.id=a.subscriber_id WHERE a.campaign_id=? ORDER BY a.created_at DESC LIMIT 100').bind(campaign.id).all();
    return json({ok:true,campaign,progress:await campaignProgress(env,campaign.id),recipients:recipients.results || [],attempts:attempts.results || []});
  }
  if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  if(['test','start','process','retry'].includes(action) && !communityMailReady(env))return json({ok:false,error:'请先配置 QQ SMTP。'},503);
  if(action==='test') {
    if(campaign.status!=='draft')return json({ok:false,error:'只有草稿可以发送测试。'},409);
    try {await sendCommunityMail(env,{to:env.FEEDBACK_TO_EMAIL,replyTo:env.FEEDBACK_TO_EMAIL,...campaignContent({...campaign,subject:'[测试] '+campaign.subject},{unsubscribe_token:'preview',confirmation_token:'preview'})})}
    catch(e){return json({ok:false,error:'测试邮件未发出：'+cleanText(e?.code || 'send_failed',80)},503)}
    await env.DB.prepare("UPDATE campaigns SET test_status='sent',tested_at=? WHERE id=? AND status='draft'").bind(isoNow(),campaign.id).run();return json({ok:true});
  }
  if(action==='start') {
    if(campaign.status!=='draft' || campaign.test_status!=='sent')return json({ok:false,error:'请先向站长邮箱发送测试邮件。'},409);
    const b=await readJson(request,2048),count=await recipientCount(env,campaign.audience);
    if(!count || b.confirmRecipientCount!==count)return json({ok:false,error:'收件人数已变化，请重新预览确认。'},409);
    const now=isoNow(),scheduled=b.scheduledAt?new Date(b.scheduledAt):null;
    if(scheduled && (!Number.isFinite(scheduled.getTime()) || scheduled.getTime()<Date.now()+30000 || scheduled.getTime()>Date.now()+365*86400000))return json({ok:false,error:'预约时间须在 30 秒至一年之后。'},400);
    const status=scheduled?'scheduled':'queued',at=scheduled?scheduled.toISOString():now;
    await env.DB.prepare("INSERT OR IGNORE INTO campaign_options(campaign_id,audience) VALUES(?,?)").bind(campaign.id,campaign.audience).run();
    await env.DB.batch([
      env.DB.prepare(`UPDATE campaigns SET status=?,updated_at=? WHERE id=? AND status='draft' AND test_status='sent' AND (SELECT COUNT(*) FROM subscribers s WHERE ${audienceWhere})=?`).bind(status,now,campaign.id,campaign.audience,campaign.audience,count),
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
    const result = await env.DB.prepare("DELETE FROM visit_events WHERE created_at < datetime('now','-90 days')").run();
    console.log(JSON.stringify({ message: "expired visits removed", changes: Number(result.meta?.changes || 0) }));
    await env.DB.prepare("DELETE FROM download_events WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')").run();
    await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(new Date().toISOString()).run();
    await env.DB.prepare("DELETE FROM admin_login_codes WHERE expires_at < ?").bind(new Date().toISOString()).run();
  },
};

export const __test = { browserFamily, cleanText, escapeHtml, feedbackEmailHtml, normalizePage, normalizePath, validEmail, installerInfo, downloadEmailContent, thankYouContent, smtpMime, sendQqSmtp, csvCell, communityMailReady, deliveryClass, dispatchCampaign, dispatchMail, scanReleases, releaseVariants, verifyReleaseToken, parseBounceReport, applyBounceReport, qqImapReports, pollBounces, mailTick };
