// A server ban also rejects API operations; this overlay explains it to visitors.
export function createSiteAccess({ request, document = globalThis.document, window = globalThis.window }) {
  let blocked = false, polling = false, timer, dialog;
  function apply(access) {
    blocked = Boolean(access.blocked);
    if (!blocked) { if (dialog?.open) dialog.close(); return; }
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'site-access-lock';
      dialog.setAttribute('closedby', 'none');
      dialog.setAttribute('aria-labelledby', 'site-access-title');
      dialog.setAttribute('aria-describedby', 'site-access-message');
      const style = document.createElement('style');
      style.textContent = `.site-access-lock{position:fixed;inset:0;box-sizing:border-box;width:100vw;max-width:none;height:100dvh;max-height:none;margin:0;border:0;padding:clamp(24px,7vw,96px);background:#101114;color:#f6f1eb;font-family:inherit;overflow:auto;text-align:center}.site-access-lock[open]{display:grid;place-content:center;gap:24px}.site-access-lock::backdrop{background:#101114}.site-access-lock h1{font-size:clamp(28px,5vw,48px);margin:0}.site-access-lock p{max-width:720px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:18px;line-height:1.9;margin:0 auto}.site-access-lock small{color:#a8a2a0;line-height:1.7}.site-access-lock button{justify-self:center;background:#2b2423;border:1px solid #74554d;color:#f6f1eb;padding:12px 20px;border-radius:10px;font:inherit;cursor:pointer}`;
      const brand = document.createElement('small'); brand.textContent = 'MUSEFILM · 访问提示 / ACCESS NOTICE';
      const title = document.createElement('h1'); title.id = 'site-access-title'; title.textContent = '当前访问已暂停';
      const message = document.createElement('p'); message.id = 'site-access-message';
      const note = document.createElement('small'); note.dataset.accessExpiry = ''; 
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '重新检查访问状态';
      button.addEventListener('click', async () => { button.disabled = true; await check(); button.disabled = false; });
      dialog.append(brand, title, message, note, button);
      dialog.addEventListener('cancel', event => event.preventDefault());
      dialog.addEventListener('close', () => { if (blocked && !dialog.open) dialog.showModal(); });
      document.head.append(style); document.body.append(dialog);
    }
    dialog.querySelector('#site-access-message').textContent = access.message || '该网络的访问已被管理员暂停。';
    dialog.querySelector('[data-access-expiry]').textContent = access.expiresAt ? `预计恢复时间：${new Date(access.expiresAt).toLocaleString()}。管理员也可提前解除。` : '请等待管理员解除限制。此页面会自动检查恢复状态。';
    // Close other modal layers so the lock is always the top layer.
    document.querySelectorAll('dialog[open]').forEach(item => { if (item !== dialog) item.close(); });
    if (!dialog.open) dialog.showModal();
  }
  async function check() {
    if (polling) return;
    polling = true;
    try { apply(await request('/api/access', { method: 'GET', headers: {}, cache: 'no-store', signal: AbortSignal.timeout(12000) })); }
    catch { /* A failed poll must never remove a known ban. */ }
    finally { polling = false; }
  }
  // Capture handlers prevent page controls and new dialogs from opening while locked.
  for (const name of ['click', 'auxclick', 'submit', 'keydown']) document.addEventListener(name, event => {
    if (blocked && (event.key === 'Escape' || !dialog?.contains(event.target))) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  const schedule = async () => { await check(); window.clearTimeout(timer); timer = window.setTimeout(schedule, 10000); };
  const resume = () => { if (!document.hidden) { window.clearTimeout(timer); void schedule(); } };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pageshow', resume);
  void schedule();
  return { apply, check, get blocked() { return blocked; } };
}
