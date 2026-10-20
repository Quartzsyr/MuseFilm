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
