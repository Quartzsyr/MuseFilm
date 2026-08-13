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
const PUBLIC_API_PATHS = new Set(["/api/config", "/api/visit", "/api/visitors", "/api/feedback"]);

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
  const halfHourBucket = Math.floor(now.getTime() / 1_800_000);
  const id = await sha256(`${halfHourBucket}:${fingerprint}:${path}`);
  const agent = request.headers.get("User-Agent") || "";
  const platform = cleanText(body.platform, 24) || "other";
  const locale = cleanText(body.locale, 12) || "unknown";
  const referrer = cleanText(body.referrerHost, 160);
  const country = cleanText(request.cf?.country, 8) || "XX";

  const recent = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM visit_events
    WHERE fingerprint = ? AND created_at >= datetime('now', '-1 hour')
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
  const result = await env.DB.prepare("SELECT COUNT(DISTINCT fingerprint) AS visitors FROM visit_events").first();
  return json({
    ok: true,
    visitors: Math.max(0, Number(result?.visitors || 0)),
  }, 200, {
    ...headers,
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
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

async function secureEqual(left, right) {
  if (!left || !right) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function adminAuthorized(request, env) {
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
    }, 200, headers);
  }
  if (url.pathname === "/api/visit" && request.method === "POST") return recordVisit(request, env, headers);
  if (url.pathname === "/api/visitors" && request.method === "GET") return publicVisitorCount(env, headers);
  if (url.pathname === "/api/feedback" && request.method === "POST") return submitFeedback(request, env, headers, ctx);
  if (url.pathname === "/api/admin/stats" && request.method === "GET") return adminStats(request, env, headers);
  if (url.pathname === "/api/admin/feedback" && request.method === "GET") return adminFeedback(request, env, headers);
  if (url.pathname === "/health" && request.method === "GET") {
    await env.DB.prepare("SELECT 1").first();
    return json({ ok: true, service: "musefilm-feedback-api" }, 200, headers);
  }
  return json({ ok: false, error: "not_found" }, 404, headers);
}

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
  async scheduled(_event, env) {
    const result = await env.DB.prepare("DELETE FROM visit_events WHERE created_at < datetime('now','-90 days')").run();
    console.log(JSON.stringify({ message: "expired visits removed", changes: Number(result.meta?.changes || 0) }));
  },
};

export const __test = { browserFamily, cleanText, escapeHtml, feedbackEmailHtml, normalizePage, normalizePath, validEmail };
