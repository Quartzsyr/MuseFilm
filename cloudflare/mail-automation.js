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
  if(header.alg!=='RS256' || !header.kid || claims.iss!=='https://token.actions.githubusercontent.com' || claims.aud!==RELEASE_AUDIENCE || !Number.isFinite(claims.exp) || claims.exp<now || !Number.isFinite(claims.iat) || claims.iat>now+30 || now-claims.iat>600 || !Number.isFinite(claims.nbf) || claims.nbf>now+30 || String(claims.repository_id)!=='1158598100' || claims.repository!=='Quartzsyr/MuseFilm' || !['release','workflow_dispatch','schedule'].includes(claims.event_name) || !/^Quartzsyr\/MuseFilm\/\.github\/workflows\/notify-release-subscribers\.yml@refs\/(heads\/main|tags\/.+)$/.test(claims.workflow_ref || ''))throw new Error('INVALID_RELEASE_TOKEN');
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
