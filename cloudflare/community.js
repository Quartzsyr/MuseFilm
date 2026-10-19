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
  const headers = ["From: MuseFilm <"+user+">","To: <"+message.to+">","Subject: =?UTF-8?B?"+encode(String(message.subject || "").replace(/[\r\n]/g," "))+"?=","Date: "+new Date().toUTCString(),"Message-ID: <"+crypto.randomUUID()+"@musefilm.top>","MIME-Version: 1.0"];
  if (validEmail(message.replyTo)) headers.push("Reply-To: <"+message.replyTo+">");
  headers.push('Content-Type: multipart/alternative; boundary="'+boundary+'"');
  return headers.join("\r\n")+"\r\n\r\n--"+boundary+"\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"+wrap(message.text)+"\r\n--"+boundary+"\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"+wrap(message.html)+"\r\n--"+boundary+"--\r\n";
}

async function sendQqSmtp(env,message,connectOverride) {
  const user=env.SMTP_USER || env.FEEDBACK_TO_EMAIL;
  if(!env.SMTP_PASSWORD || !validEmail(user)) throw Object.assign(new Error("QQ SMTP not configured"),{code:"SMTP_NOT_CONFIGURED"});
  const connect=connectOverride || (await import("node:tls")).connect;
  const socket=connect({host:"smtp.qq.com",port:465,servername:"smtp.qq.com",rejectUnauthorized:true});
  let buffer="",pending=null,failed=null;const replies=[];
  const fail=error=>{failed=error;if(pending){pending.reject(error);pending=null}};
  socket.on("error",()=>fail(Object.assign(new Error("SMTP connection failed"),{code:"SMTP_CONNECTION_FAILED"})));
  socket.on("close",()=>{if(pending)fail(Object.assign(new Error("SMTP connection closed"),{code:"SMTP_CONNECTION_CLOSED"}))});
  socket.setTimeout(15000,()=>{fail(Object.assign(new Error("SMTP timeout"),{code:"SMTP_TIMEOUT"}));socket.destroy()});
  socket.on("data",chunk=>{
    buffer+=chunk.toString();if(buffer.length>131072){fail(Object.assign(new Error("SMTP reply too large"),{code:"SMTP_BAD_REPLY"}));socket.destroy();return}
    let end;
    while((end=buffer.indexOf("\r\n"))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);if(/^\d{3} /.test(line)){const code=Number(line.slice(0,3));if(pending){const current=pending;pending=null;current.resolve(code)}else replies.push(code)}}
  });
  const reply=()=>failed?Promise.reject(failed):replies.length?Promise.resolve(replies.shift()):new Promise((resolve,reject)=>{pending={resolve,reject}});
  const expect=async code=>{const received=await reply();if(received!==code)throw Object.assign(new Error("SMTP rejected command"),{code:"SMTP_"+received})};
  const command=async(line,code)=>{await new Promise((resolve,reject)=>socket.write(line+"\r\n",error=>error?reject(error):resolve()));await expect(code)};
  const encode=value=>btoa(String.fromCharCode(...new TextEncoder().encode(value)));
  try {
    await expect(220);await command("EHLO musefilm.top",250);await command("AUTH LOGIN",334);await command(encode(user),334);await command(encode(env.SMTP_PASSWORD),235);
    await command("MAIL FROM:<"+user+">",250);await command("RCPT TO:<"+message.to+">",250);await command("DATA",354);
    await command(smtpMime(message,user).replace(/(^|\r\n)\./g,"$1..")+"\r\n.",250);
    // Successful DATA acknowledgement is the delivery boundary; QUIT is best effort.
    socket.write("QUIT\r\n");return {accepted:true};
  } finally {socket.end();socket.destroy()}
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
    if (!subscriber || subscriber.status === "unsubscribed") status = "suppressed";
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
  const rows = await env.DB.prepare(`SELECT id,email,status,locale,platform,consent_at,confirmed_at,created_at,last_download_at,(SELECT status FROM subscriber_mail_log WHERE subscriber_id=subscribers.id ORDER BY created_at DESC LIMIT 1) AS thank_you_status FROM subscribers ${where} ORDER BY created_at DESC LIMIT 50 OFFSET ?`).bind(...values,(page-1)*50).all();
  const stats = await env.DB.prepare("SELECT COUNT(*) AS total,SUM(status='subscribed') AS subscribed,SUM(status='pending') AS pending,SUM(status='contact') AS contact,SUM(status='unsubscribed') AS unsubscribed FROM subscribers").first();
  return json({ok:true,subscribers:rows.results || [],total:Number(count?.count || 0),page,stats});
}

function campaignContent(campaign,subscriber) {
  const unsubscribe = subscriberLinks(subscriber).unsubscribe;
  return { subject:campaign.subject,html:subscriberEmailHtml(campaign.subject,campaign.body.split(/\n\s*\n/),emailButton("https://musefilm.top/#download","打开 MuseFilm"),`你已订阅 MuseFilm 的版本更新与新闻。<br><a href="${escapeHtml(unsubscribe)}" style="color:#bd9d85">退订后续邮件</a> · musefilm.top`),text:campaign.subject+"\n\n"+campaign.body+`\n\n下载：https://musefilm.top/#download\n退订：${unsubscribe}` };
}

async function campaignProgress(env,id) {
  const rows = await env.DB.prepare("SELECT status,COUNT(*) AS count FROM campaign_recipients WHERE campaign_id=? GROUP BY status").bind(id).all();
  const progress = {pending:0,sending:0,sent:0,failed:0,skipped:0};
  for (const row of rows.results || []) progress[row.status]=Number(row.count);
  return progress;
}

async function processCampaign(env,campaign) {
  const rows = await env.DB.prepare("SELECT subscriber_id FROM campaign_recipients WHERE campaign_id=? AND status='pending' LIMIT 3").bind(campaign.id).all();
  for (const row of rows.results || []) {
    const claimed = await env.DB.prepare("UPDATE campaign_recipients SET status='sending' WHERE campaign_id=? AND subscriber_id=? AND status='pending'").bind(campaign.id,row.subscriber_id).run();
    if (!Number(claimed.meta?.changes || 0)) continue;
    const subscriber = await env.DB.prepare("SELECT * FROM subscribers WHERE id=? AND status='subscribed'").bind(row.subscriber_id).first();
    let status="skipped",error="";
    if (subscriber) {
      try { await sendCommunityMail(env,{to:subscriber.email,from:env.FEEDBACK_FROM_EMAIL,replyTo:env.FEEDBACK_TO_EMAIL,...campaignContent(campaign,subscriber)});status="sent"; }
      catch(e) { status="failed";error=cleanText(e?.code || "send_failed",80); }
    }
    await env.DB.prepare("UPDATE campaign_recipients SET status=?,error_code=?,sent_at=? WHERE campaign_id=? AND subscriber_id=?").bind(status,error,status==='sent' ? new Date().toISOString() : null,campaign.id,row.subscriber_id).run();
  }
  const progress = await campaignProgress(env,campaign.id);
  if (!progress.pending && !progress.sending) await env.DB.prepare("UPDATE campaigns SET status=?,updated_at=? WHERE id=?").bind(progress.failed ? "partial_failure" : "sent",new Date().toISOString(),campaign.id).run();
  return progress;
}

async function handleCommunity(request,env) {
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
  if(path === "/api/admin/campaigns" && request.method === "GET") {
    const rows=await env.DB.prepare("SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 50").all();return json({ok:true,campaigns:rows.results || []});
  }
  const match=path.match(/^\/api\/admin\/campaigns\/([^/]+)(?:\/(preview|test|start|process|progress))?$/);
  if((path === "/api/admin/campaigns" && request.method === "POST") || (match && !match[2] && request.method === "PATCH")) {
    const body=await readJson(request,24576),subject=cleanText(body.subject,160),text=cleanText(body.body,20000);
    if(subject.length<3 || text.length<10) return json({ok:false,error:"请填写标题与正文（至少 10 字）。"},400);
    const id=match ? match[1] : crypto.randomUUID(),now=new Date().toISOString();
    if(match) {
      const result=await env.DB.prepare("UPDATE campaigns SET subject=?,body=?,test_status='',tested_at=NULL,updated_at=? WHERE id=? AND status='draft'").bind(subject,text,now,id).run();
      if(!Number(result.meta?.changes || 0)) return json({ok:false,error:"只有草稿可以修改。"},409);
    } else await env.DB.prepare("INSERT INTO campaigns(id,subject,body,created_at,updated_at) VALUES(?,?,?,?,?)").bind(id,subject,text,now,now).run();
    return json({ok:true,id});
  }
  if(match) {
    const campaign=await env.DB.prepare("SELECT * FROM campaigns WHERE id=?").bind(match[1]).first();
    if(!campaign) return json({ok:false,error:"not_found"},404);
    const action=match[2];
    if (["test","start","process"].includes(action) && !communityMailReady(env)) return json({ok:false,error:"请先配置 QQ 邮箱 SMTP_USER 和 SMTP_PASSWORD。"},503);
    if(action === "preview") {
      const count=await env.DB.prepare("SELECT COUNT(*) AS count FROM subscribers WHERE status='subscribed'").first();
      return json({ok:true,html:campaignContent(campaign,{unsubscribe_token:"preview",confirmation_token:"preview"}).html,recipientCount:Number(count?.count || 0),campaign});
    }
    if(action === "progress") return json({ok:true,progress:await campaignProgress(env,campaign.id)});
    if(action === "test" && request.method === "POST") {
      try { await sendCommunityMail(env,{to:env.FEEDBACK_TO_EMAIL,from:env.FEEDBACK_FROM_EMAIL,replyTo:env.FEEDBACK_TO_EMAIL,...campaignContent({...campaign,subject:"[测试] "+campaign.subject},{unsubscribe_token:"preview",confirmation_token:"preview"})}); }
      catch(error) {return json({ok:false,error:`测试邮件未发出：${cleanText(error?.code || "send_failed",80)}`},503);}
      await env.DB.prepare("UPDATE campaigns SET test_status='sent',tested_at=? WHERE id=?").bind(new Date().toISOString(),campaign.id).run();return json({ok:true});
    }
    if(action === "start" && request.method === "POST") {
      if(campaign.status!=="draft" || campaign.test_status!=="sent") return json({ok:false,error:"请先向站长邮箱发送测试邮件。"},409);
      const body=await readJson(request,1024),count=await env.DB.prepare("SELECT COUNT(*) AS count FROM subscribers WHERE status='subscribed'").first();
      if(!Number(count?.count) || body.confirmRecipientCount!==Number(count.count)) return json({ok:false,error:"收件人数已变化，请重新预览确认。"},409);
      const changed=await env.DB.prepare("UPDATE campaigns SET status='sending',updated_at=? WHERE id=? AND status='draft'").bind(new Date().toISOString(),campaign.id).run();
      if(!Number(changed.meta?.changes || 0)) return json({ok:false,error:"邮件已开始发送。"},409);
      await env.DB.prepare("INSERT OR IGNORE INTO campaign_recipients(campaign_id,subscriber_id) SELECT ?,id FROM subscribers WHERE status='subscribed'").bind(campaign.id).run();
      return json({ok:true,progress:await campaignProgress(env,campaign.id)});
    }
    if(action === "process" && request.method === "POST") {
      if(campaign.status!=="sending") return json({ok:false,error:"此邮件不在发送状态。"},409);
      return json({ok:true,progress:await processCampaign(env,campaign)});
    }
  }
  return null;
}
