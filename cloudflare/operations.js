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
  const bullets=[],paragraphs=[];let include=true;
  for(const raw of item.notes.split(/\r?\n/)) {
    const heading=raw.match(/^#{1,6}\s+(.+)/);
    if(heading){if(/历史版本|历史更新/.test(heading[1]))break;include=!/版本信息|安装|发布验证|SHA.?256|校验|反馈|签名|构建|测试/.test(heading[1]);continue}
    const line=raw.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').trim();
    if(!include || !line || /^\||^[-_*]{3,}$|^https?:/.test(line))continue;
    if(/^[-*+]\s+/.test(line))bullets.push(line.replace(/^[-*+]\s+/,''));else if(!/^>/.test(line))paragraphs.push(line);
  }
  const selected=(bullets.length?bullets:paragraphs).slice(0,6),notes=selected.map(line=>'• '+(line.length>180?line.slice(0,180)+'…':line)).join('\n') || '本次更新已经准备好，欢迎查看完整版本说明。';
  return `你好，\n\nMuseFilm ${label} ${item.title}${item.preview?'（预览版）':''} 已准备好。\n\n这次更新带来了这些改进：\n${notes}\n\n查看完整说明与下载：\n${item.url}\n\n用起来有什么感受或建议，欢迎直接回复这封邮件。谢谢你陪 MuseFilm 留住每一卷光。`;
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
