import { isIP } from 'node:net';

export const DEFAULT_DOWNLOAD_LIMITS = { windowMinutes: 30, windowLimit: 3, dailyLimit: 10 };
const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export function normalizeIp(value) {
  if (typeof value !== 'string' || !isIP(value.trim())) return '';
  const ip = value.trim();
  if (isIP(ip) === 4) return ip;
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  // IPv4-mapped IPv6 addresses share the IPv4 policy and quota.
  const mapped = canonical.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
  if (mapped) return [parseInt(mapped[1], 16) >> 8, parseInt(mapped[1], 16) & 255, parseInt(mapped[2], 16) >> 8, parseInt(mapped[2], 16) & 255].join('.');
  return canonical;
}

export const connectionIp = request => normalizeIp(request.headers.get('CF-Connecting-IP'));

export async function downloadLimits(env) {
  const row = await env.DB.prepare('SELECT window_minutes, window_limit, daily_limit FROM download_security_settings WHERE id=1').first();
  return row?.window_minutes ? { windowMinutes: row.window_minutes, windowLimit: row.window_limit, dailyLimit: row.daily_limit } : { ...DEFAULT_DOWNLOAD_LIMITS };
}

export async function ipAccess(request, env) {
  const ip = connectionIp(request);
  if (!ip) return { blocked: false, message: '', expiresAt: null };
  const row = await env.DB.prepare("SELECT blocked,message,expires_at FROM ip_controls WHERE ip_address=? AND (expires_at IS NULL OR expires_at>?)").bind(ip, new Date().toISOString()).first();
  return { blocked: Boolean(row?.blocked || row?.message), message: row?.message || (row?.blocked ? '该网络的访问已被管理员暂停。' : ''), expiresAt: row?.expires_at || null };
}

export async function handleSecurityAdmin(request, env) {
  const path = new URL(request.url).pathname;
  if (!['/api/admin/download-security', '/api/admin/ip-controls'].includes(path)) return null;
  if (request.method === 'GET') {
    if (path.endsWith('download-security')) return reply({ ok: true, settings: await downloadLimits(env) });
    const [controls, history] = await Promise.all([
      env.DB.prepare("SELECT * FROM ip_controls WHERE (blocked=1 OR message<>'') AND (expires_at IS NULL OR expires_at>?) ORDER BY updated_at DESC LIMIT 100").bind(new Date().toISOString()).all(),
      env.DB.prepare('SELECT * FROM ip_control_history ORDER BY created_at DESC, rowid DESC LIMIT 50').all(),
    ]);
    return reply({ ok: true, controls: controls.results || [], history: history.results || [] });
  }
  if (request.method !== 'POST') return reply({ ok: false, error: 'method_not_allowed' }, 405);
  if (Number(request.headers.get('Content-Length')) > 8192) return reply({ ok: false, error: 'payload_too_large' }, 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 8192) return reply({ ok: false, error: 'payload_too_large' }, 413);
  let body; try { body = JSON.parse(text); } catch { return reply({ ok: false, error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ ok: false, error: 'invalid_request' }, 400);
  const now = new Date().toISOString();
  if (path.endsWith('download-security')) {
    const { windowMinutes, windowLimit, dailyLimit } = body;
    if (![windowMinutes, windowLimit, dailyLimit].every(Number.isInteger) || windowMinutes < 1 || windowMinutes > 1440 || windowLimit < 1 || windowLimit > 100 || dailyLimit < 1 || dailyLimit > 1000 || dailyLimit < windowLimit) return reply({ ok: false, error: 'invalid_limits' }, 400);
    await env.DB.batch([
      env.DB.prepare('UPDATE download_security_settings SET window_minutes=?,window_limit=?,daily_limit=?,updated_at=? WHERE id=1').bind(windowMinutes, windowLimit, dailyLimit, now),
      env.DB.prepare('INSERT INTO ip_control_history(id,ip_address,action,message,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), '', 'settings', JSON.stringify(body), now),
    ]);
    return reply({ ok: true, settings: { windowMinutes, windowLimit, dailyLimit } });
  }
  const ip = normalizeIp(body.ip), action = body.action;
  if (!ip || !['ban', 'message', 'release'].includes(action)) return reply({ ok: false, error: 'invalid_ip_action' }, 400);
  if (body.message !== undefined && typeof body.message !== 'string') return reply({ ok: false, error: 'invalid_message' }, 400);
  let message = (body.message || '').replace(/\u0000/g, '').trim();
  if (message.length > 2000 || (action === 'message' && !message)) return reply({ ok: false, error: 'invalid_message' }, 400);
  if (action === 'ban' && !message) message = '由于异常下载行为，该网络的访问已被管理员暂停。';
  if (action === 'release') message = '';
  const duration = body.durationMinutes ?? 0;
  if (!Number.isInteger(duration) || duration < 0 || duration > 525600) return reply({ ok: false, error: 'invalid_duration' }, 400);
  const expiresAt = action !== 'release' && duration ? new Date(Date.now() + duration * 60000).toISOString() : null;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ip_controls(ip_address,blocked,message,expires_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(ip_address) DO UPDATE SET blocked=excluded.blocked,message=excluded.message,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
      .bind(ip, action === 'ban' ? 1 : 0, message, expiresAt, now),
    env.DB.prepare('INSERT INTO ip_control_history(id,ip_address,action,message,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), ip, action, message, now),
  ]);
  return reply({ ok: true, ip, action, expiresAt });
}
