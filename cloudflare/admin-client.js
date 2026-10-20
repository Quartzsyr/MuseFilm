'use strict';
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const names={overview:'概览',mail:'邮件',subscribers:'订阅者',activity:'活动记录',automation:'自动化'};
const audiences={all:'全部有效订阅者',windows:'Windows 用户',mac:'macOS 用户'};
const deliveryNames={draft:'草稿',scheduled:'预约中',queued:'排队中',pending:'待发送',sending:'发送中',retry_wait:'等待重试',sent:'已提交',failed:'失败',partial_failure:'需要处理',uncertain:'待核实',bounced:'已退信',skipped:'已跳过',cancelled:'已取消',suppressed:'已停止',not_configured:'未配置'};
const subscriptionNames={subscribed:'已订阅',pending:'待确认',contact:'仅留邮箱',unsubscribed:'已退订'};
const feedbackNames={new:'待处理',reviewing:'处理中',resolved:'已处理',archived:'已归档'};
const state={view:'overview',viewToken:0,loaders:0,overview:null,mailConfig:null,campaigns:[],mailFilter:'all',page:1,subscriberTotal:0,activity:'downloads',downloads:[],feedback:[],settings:null,settingsSig:'',mailBusy:false,editor:{id:'',saved:null,sig:'',html:''},detail:null,detailToken:0,review:null,challengeId:'',confirmResolve:null};
let toastTimer,progressTimer,loginTimer;
function esc(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function number(value){return Number(value || 0).toLocaleString('zh-CN')}
function date(value){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚无记录'}
function shortDate(value){return value?new Date(value).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}):'—'}
function badge(status,kind='delivery'){
  const labels=kind==='subscription'?subscriptionNames:kind==='feedback'?feedbackNames:deliveryNames;
  const good=kind==='subscription'?status==='subscribed':kind==='feedback'?status==='resolved':status==='sent';
  const tone=good?'good':['failed','partial_failure','uncertain','bounced'].includes(status)?'bad':['pending','queued','sending','retry_wait','new','reviewing'].includes(status)?'wait':status==='scheduled'?'info':'';
  return `<span class="badge ${tone}">${esc(labels[status] || status || '—')}</span>`;
}
function emptyRow(columns,title,description=''){return `<tr><td colspan="${columns}" class="empty"><strong>${esc(title)}</strong>${esc(description)}</td></tr>`}
function toast(message,error=false){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.toggle('error',error);$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,error?8000:4500)}
function pageError(error){$('#page-error-text').textContent=error.message || String(error);$('#page-error').hidden=false}
function showLogin(message=''){clearTimeout(progressTimer);$('#dashboard').hidden=true;$('#login').hidden=false;$('#login-message').textContent=message}
async function api(path,{method='GET',body,raw=false}={}){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),40000);state.loaders++;$('#loading-line').hidden=false;
  try {
    const response=await fetch(path,{method,cache:'no-store',credentials:'same-origin',signal:controller.signal,headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.status===401 && !path.includes('/login')){showLogin('登录已过期，请重新登录。当前页面的邮件内容已保留。');throw Object.assign(new Error('请重新登录后继续。'),{status:401})}
    if(raw && response.ok)return response;
    let data;try{data=await response.json()}catch{throw new Error('服务器返回异常，请稍后重试。')}
    if(!response.ok || !data.ok){const errors={internal_error:'服务暂时不可用，请稍后重试。',origin_not_allowed:'请求来源无效，请重新打开后台。',not_found:'该记录不存在，请刷新列表。'};throw Object.assign(new Error(errors[data.error] || data.error || '操作失败，请重试。'),{status:response.status})}
    return data;
  }catch(error){if(error.name==='AbortError')throw new Error('请求超时，请刷新状态后重试。');if(error instanceof TypeError)throw new Error('网络连接失败，请检查网络后重试。');throw error}
  finally{clearTimeout(timeout);state.loaders--;$('#loading-line').hidden=state.loaders===0}
}
const post=(path,body={})=>api(path,{method:'POST',body});
function confirmAction(title,text,label='确认'){
  if($('#confirm-dialog').open)return Promise.resolve(false);
  $('#confirm-title').textContent=title;$('#confirm-text').textContent=text;$('#confirm-accept').textContent=label;$('#confirm-dialog').showModal();
  return new Promise(resolve=>state.confirmResolve=resolve);
}
function resolveConfirm(answer){const resolve=state.confirmResolve;state.confirmResolve=null;$('#confirm-dialog').close();resolve?.(answer)}
$('#confirm-cancel').onclick=()=>resolveConfirm(false);$('#confirm-accept').onclick=()=>resolveConfirm(true);$('#confirm-dialog').addEventListener('cancel',event=>{event.preventDefault();resolveConfirm(false)});
function updateSync(){const now=new Date();$('#last-sync').textContent='更新于 '+now.toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'})}
async function navigate(view,{load=true}={}){
  if(!names[view])view='overview';state.view=view;state.viewToken++;clearTimeout(progressTimer);$('#page-error').hidden=true;
  $$('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==view);$$('.nav [data-view]').forEach(button=>{if(button.dataset.view===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')});
  $('#breadcrumb').textContent=names[view];document.title=names[view]+' · MuseFilm 后台';history.replaceState(null,'','#'+view);
  if(load)await loadCurrent();
}
async function loadCurrent(){const token=state.viewToken;$('#page-error').hidden=true;try{
  if(state.view==='overview')await loadOverview(token);
  else if(state.view==='mail'){await loadCampaigns(token);if(!$('#mail-detail-view').hidden)await loadDelivery()}
  else if(state.view==='subscribers')await loadSubscribers(token);
  else if(state.view==='activity')await loadActivity(token);
  else if(state.view==='automation')await loadAutomation(token);
  if(token===state.viewToken)updateSync();
}catch(error){if(error.status!==401 && token===state.viewToken)pageError(error)}}
function campaignRows(campaigns){return campaigns.map(c=>`<tr><td class="subject-cell"><strong>${esc(c.subject)}</strong><small>${c.kind==='release'?'自动版本通知':'手动邮件'}</small></td><td>${esc(audiences[c.audience] || audiences.all)}</td><td>${badge(c.status)}</td><td>${esc(date(c.scheduled_at || c.updated_at))}</td><td><button class="small quiet" data-open-campaign="${esc(c.id)}">${c.status==='draft'?'编辑':'查看'}</button></td></tr>`).join('')}
async function loadOverview(token){const data=await api('/api/admin/overview');state.overview=data;state.audienceCounts=data.audiences || {all:data.totals.subscribers};$('#preview-banner').hidden=!data.preview;if(token!==state.viewToken || state.view!=='overview')return;
  $('#preview-banner').hidden=!data.preview;for(const key of ['visits','downloads','subscribers','queued'])$('#metric-'+key).textContent=number(data.totals[key]);
  $('#nav-mail-count').textContent=number(data.totals.queued);$('#nav-mail-count').hidden=!data.totals.queued;$('#nav-feedback-count').textContent=number(data.totals.feedback);$('#nav-feedback-count').hidden=!data.totals.feedback;
  const s=data.settings || {},tickGood=s.last_tick_at && Date.now()-Date.parse(s.last_tick_at)<10*60000;
  const health=[['邮件服务',data.mailReady?'已配置':'未配置',data.mailReady],['版本自动通知',s.scan_error?'检查异常':s.enabled?'已启用':'已暂停',Boolean(s.enabled && !s.scan_error)],['退信检查',!s.imap_enabled?'已暂停':s.imap_error?'检查异常':s.imap_last_at?'连接正常':'等待检查',Boolean(s.imap_enabled && s.imap_last_at && !s.imap_error)],['定时任务',tickGood?'运行正常':s.last_tick_at?'运行延迟':'等待首次运行',tickGood]];
  $('#health-list').innerHTML=health.map(([title,value,good])=>`<div class="health-row"><span>${esc(title)}</span><span class="health-value ${good?'':'warning'}"><i class="dot ${good?'green':''}"></i>${esc(value)}</span></div>`).join('');
  $('#attention-note').hidden=!data.totals.attention;$('#attention-note').textContent=number(data.totals.attention)+' 条投递需要处理，查看邮件 →';
  $('#recent-campaigns').innerHTML=data.campaigns.length?campaignRows(data.campaigns):emptyRow(5,'还没有邮件','点击“新建邮件”开始写第一封。');
  renderTraffic(data.daily);renderEditorStatus();
}
function renderTraffic(daily){const viewMap=new Map((daily.views || []).map(row=>[row.day,Number(row.count)])),downloadMap=new Map((daily.downloads || []).map(row=>[row.day,Number(row.count)]));
  const days=Array.from({length:7},(_,index)=>new Date(Date.now()+8*3600000-(6-index)*86400000).toISOString().slice(0,10));const max=Math.max(1,...days.map(day=>viewMap.get(day)||0),...days.map(day=>downloadMap.get(day)||0));
  $('#traffic-chart').innerHTML=days.map(day=>{const views=viewMap.get(day)||0,downloads=downloadMap.get(day)||0;return `<div class="chart-day" title="${esc(day)}：${views} 次访问，${downloads} 次下载点击"><div class="chart-bars"><span class="chart-bar" style="--height:${Math.round(views/max*100)}%"></span><span class="chart-bar secondary" style="--height:${Math.round(downloads/max*100)}%"></span></div><small>${esc(day.slice(5).replace('-','/'))}</small></div>`}).join('');
  const views=days.reduce((sum,day)=>sum+(viewMap.get(day)||0),0),downloads=days.reduce((sum,day)=>sum+(downloadMap.get(day)||0),0);const summary=`近 7 日共 ${number(views)} 次访问，${number(downloads)} 次下载点击。`;$('#traffic-summary').textContent=summary;$('#traffic-chart').setAttribute('aria-label',summary+days.map(day=>`${day} 访问 ${viewMap.get(day)||0}，下载 ${downloadMap.get(day)||0}`).join('；'));
}
async function loadCampaigns(token=state.viewToken){const data=await api('/api/admin/campaigns');state.campaigns=data.campaigns;if(state.view==='mail' && token===state.viewToken)renderCampaigns()}
function renderCampaigns(){const query=$('#mail-search').value.trim().toLowerCase();const campaigns=state.campaigns.filter(c=>c.subject.toLowerCase().includes(query) && (state.mailFilter==='all' || state.mailFilter==='active' && ['queued','sending','retry_wait'].includes(c.status) || state.mailFilter==='done' && ['sent','partial_failure','cancelled'].includes(c.status) || c.status===state.mailFilter));$('#campaign-rows').innerHTML=campaigns.length?campaignRows(campaigns):emptyRow(5,'没有符合条件的邮件',state.campaigns.length?'试试其他筛选条件。':'点击“新建邮件”创建草稿。')}
function subscriberQuery(){const form=$('#subscriber-filters');return new URLSearchParams({q:form.elements.q.value,status:form.elements.status.value,platform:form.elements.platform.value,page:String(state.page)})}
async function loadSubscribers(token=state.viewToken){const query=subscriberQuery().toString(),data=await api('/api/admin/subscribers?'+query);if(token!==state.viewToken || state.view!=='subscribers' || query!==subscriberQuery().toString())return;state.subscriberTotal=data.total;
  $('#subscriber-summary').textContent=`共 ${number(data.stats?.total)} 个邮箱，${number(data.stats?.eligible)} 位有效订阅者。`;
  $('#subscriber-rows').innerHTML=data.subscribers.length?data.subscribers.map(row=>`<tr><td>${esc(row.email)}<small>加入于 ${esc(shortDate(row.created_at))}</small></td><td>${badge(row.status,'subscription')}${row.suppression_reason?'<small style="color:var(--red)">退信抑制中</small>':''}</td><td>${esc((row.platforms || row.platform || '').split(',').filter(Boolean).map(p=>p==='mac'?'macOS':p==='windows'?'Windows':p).join(' / ') || '—')}</td><td>${badge(row.thank_you_status)}</td><td>${esc(row.last_download_at?date(row.last_download_at):'—')}</td><td>${row.status==='unsubscribed'?'<span class="muted">—</span>':`<button class="small quiet" data-stop-subscriber="${esc(row.id)}" data-email="${esc(row.email)}">停止发信</button>`}</td></tr>`).join(''):emptyRow(6,'没有符合条件的邮箱','可以清除筛选或等待访客自愿留下邮箱。');
  $('#subscriber-page').textContent=`${number(data.total)} 条结果 · 第 ${state.page} / ${Math.max(1,Math.ceil(data.total/50))} 页`;$('#previous-page').disabled=state.page<=1;$('#next-page').disabled=state.page*50>=data.total;
}
async function loadActivity(token=state.viewToken){const mode=state.activity,data=await api('/api/admin/'+(mode==='feedback'?'feedback':'downloads'));if(token!==state.viewToken || mode!==state.activity || state.view!=='activity')return;if(mode==='feedback')state.feedback=data.feedback;else state.downloads=data.downloads;renderActivity()}
function renderActivity(){const query=$('#activity-search').value.trim().toLowerCase();$('#downloads-panel').hidden=state.activity!=='downloads';$('#feedback-panel').hidden=state.activity!=='feedback';
  if(state.activity==='downloads'){const rows=state.downloads.filter(row=>[row.asset_name,row.contact_email,row.ip_address,row.country,row.region,row.city,row.operating_system].join(' ').toLowerCase().includes(query));$('#download-rows').innerHTML=rows.length?rows.map(row=>`<tr><td>${esc(date(row.created_at))}</td><td class="subject-cell"><strong>${esc(row.asset_name)}</strong><small>${esc(row.contact_email || '未留下邮箱')}</small></td><td>${esc(row.operating_system || '—')}<small>${esc(row.browser || '')}</small></td><td>${esc(row.ip_address || '—')}<small>${esc([row.country,row.region,row.city].filter(Boolean).join(' / ') || '未知地区')}</small></td><td>${badge(row.email_status)}</td></tr>`).join(''):emptyRow(5,'没有符合条件的下载记录');return}
  const rows=state.feedback.filter(row=>[row.message,row.contact_email,row.type].join(' ').toLowerCase().includes(query));$('#feedback-list').innerHTML=rows.length?rows.map(row=>`<article class="feedback-card"><div class="feedback-top"><div class="feedback-meta"><span class="badge">${esc({bug:'问题反馈',suggestion:'功能建议',other:'其他'}[row.type] || '反馈')}</span><span>${esc(date(row.created_at))}</span></div>${badge(row.status,'feedback')}</div><p class="feedback-body">${esc(row.message)}</p><div class="feedback-bottom"><span>${esc(row.contact_email || '未留下联系邮箱')} · ${esc(row.platform || '—')}</span><select aria-label="处理 ${esc(row.contact_email || '匿名用户')} 的反馈" data-feedback-status="${esc(row.id)}">${Object.entries(feedbackNames).map(([value,label])=>`<option value="${value}" ${value===row.status?'selected':''}>${label}</option>`).join('')}</select></div></article>`).join(''):'<div class="empty"><strong>还没有符合条件的反馈</strong>网站提交的建议和问题会显示在这里。</div>';
}
function settingsValues(){const form=$('#automation-form');return {enabled:form.elements.enabled.checked,includePrerelease:form.elements.includePrerelease.checked,imapEnabled:form.elements.imapEnabled.checked}}
function settingsDirty(){return state.settingsSig && JSON.stringify(settingsValues())!==state.settingsSig}
function renderSettingsSave(){const dirty=settingsDirty();$('#settings-save-state').textContent=dirty?'有未保存的更改':'设置已保存';$('#settings-save-state').classList.toggle('dirty',Boolean(dirty))}
async function loadAutomation(token=state.viewToken,{reset=false}={}){const [data,bounces,config]=await Promise.all([api('/api/admin/automation'),api('/api/admin/bounces'),getMailConfig()]);if(token!==state.viewToken || state.view!=='automation')return;const preserve=settingsDirty() && !reset;state.settings=data.settings;const s=data.settings;
  if(!preserve){$$('#automation-form input,#save-settings').forEach(control=>control.disabled=false);const values={enabled:Boolean(s.enabled),includePrerelease:Boolean(s.include_prerelease),imapEnabled:Boolean(s.imap_enabled)};for(const [key,value] of Object.entries(values))$('#automation-form').elements[key].checked=value;state.settingsSig=JSON.stringify(values)}
  state.audienceCounts={all:state.overview?.totals.subscribers || data.groups.reduce((sum,g)=>sum+Number(g.count),0),...Object.fromEntries(data.groups.map(g=>[g.platform,Number(g.count)]))};
  $('#release-health').innerHTML=`<span class="badge ${s.scan_error?'bad':s.enabled?'good':''}">${s.scan_error?'检查异常':s.enabled?'已启用':'已暂停'}</span>`;$('#release-meta').innerHTML=`<span>版本基线：${esc(date(s.baseline_at))}</span><span>最近检查：${esc(date(s.last_scan_at))}${s.scan_error?' · '+esc(s.scan_error):''}</span><span>服务器运行：${esc(date(s.last_tick_at))}</span>`;
  $('#imap-health').innerHTML=`<span class="badge ${s.imap_error?'bad':s.imap_last_at?'good':''}">${esc(!s.imap_enabled?'已暂停':s.imap_error?'检查异常':s.imap_last_at?'连接正常':'等待检查')}</span>`;
  $('#imap-meta').innerHTML=`<span>最近检查：${esc(date(s.imap_last_at))}</span><span>已检查退信候选：${number(s.imap_checked)} 封${s.imap_error?' · '+esc(s.imap_error):''}</span>`;
  $('#smtp-health').innerHTML=`<span class="badge ${config.ready?'good':'bad'}">${config.ready?'发信服务已配置':'发信服务未配置'}</span>`;
  $('#suppression-rows').innerHTML=bounces.suppressed.length?bounces.suppressed.map(row=>`<tr><td>${esc(row.email)}</td><td>${row.reason==='hard_bounce'?'终止投递的退信':esc(row.reason)}</td><td>${esc({qq_imap:'QQ IMAP',smtp_rcpt:'发送时拒收'}[row.source] || row.source)}</td><td>${esc(date(row.created_at))}</td><td><button class="small quiet" data-restore-email="${esc(row.email)}">解除抑制</button></td></tr>`).join(''):emptyRow(5,'没有停止投递的地址');
  $('#bounce-rows').innerHTML=bounces.bounces.length?bounces.bounces.map(row=>`<tr><td>${esc(date(row.created_at))}</td><td class="subject-cell"><strong>${esc(row.email)}</strong><small>${esc(row.subject || '')}</small></td><td>${row.kind==='hard'?'终止投递':'投递延迟'}</td><td class="break">${esc(row.diagnostic)}</td></tr>`).join(''):emptyRow(4,'暂无匹配的退信报告');renderSettingsSave();
}
async function getMailConfig(force=false){if(!state.mailConfig || force)state.mailConfig=await api('/api/admin/mail-config');return state.mailConfig}
function editorFields(){const form=$('#mail-form');return {subject:form.elements.subject.value.trim(),body:form.elements.body.value.trim(),audience:form.elements.audience.value}}
function editorSignature(fields=editorFields()){return JSON.stringify(fields)}
function editorDirty(){return editorSignature()!==state.editor.sig}
function testedCurrent(){return !editorDirty() && state.editor.saved?.test_status==='sent'}
function renderEditorStatus(){
  const fields=editorFields(),dirty=editorDirty(),tested=testedCurrent(),estimated=state.audienceCounts?.[fields.audience];
  $('#body-count').textContent=number($('#mail-body').value.length)+' / 20,000';$('#save-state').textContent=state.mailBusy?'正在处理…':dirty?'有未保存的更改':state.editor.id?'已保存草稿':'新邮件';$('#save-state').classList.toggle('dirty',dirty);
  $('#estimated-recipients').textContent=estimated===undefined?'发送前核对':number(estimated)+' 人';$('#audience-help').textContent=estimated===0?'该分组当前没有有效订阅者，可更换分组或查看订阅者。':'仅向已订阅且未停止投递的邮箱发送。';
  $('#test-status').innerHTML=`<svg class="icon" style="color:${tested?'var(--green)':'var(--orange)'}"><use href="#i-${tested?'check':'clock'}"/></svg><span>${tested?'当前内容的测试邮件已提交至站长邮箱。':dirty && state.editor.saved?.test_status==='sent'?'内容已修改，需要重新测试当前邮件。':'正式发送前，先给站长邮箱发一封测试信。'}</span>`;
  if(!state.mailBusy){$('#test-mail').textContent=tested?'重新发送测试':'发送测试邮件';$('#prepare-send').innerHTML=`${$('#mail-form').elements.delivery.value==='later'?'检查并预约':'检查并发送'} <svg class="icon"><use href="#i-arrow"/></svg>`}
  const later=$('#mail-form').elements.delivery.value==='later';$('#schedule-field').hidden=!later;
}
function validateEditor(){let valid=true;for(const [key,id,message] of [['subject','mail-subject','请填写邮件标题。'],['body','mail-body','请填写邮件正文。']]){const empty=!editorFields()[key];$('#'+key+'-error').textContent=empty?message:'';$('#'+id).setAttribute('aria-invalid',String(empty));if(empty)valid=false}if(!valid){(!editorFields().subject?$('#mail-subject'):$('#mail-body')).focus();throw new Error('请补全标出的邮件内容。')}return editorFields()}
function scheduledTime(){const later=$('#mail-form').elements.delivery.value==='later',value=$('#schedule-time').value;$('#schedule-error').textContent='';if(!later)return null;const time=Date.parse(value);if(!Number.isFinite(time)||time<Date.now()+30000||time>Date.now()+365*86400000){$('#schedule-error').textContent='请选择 30 秒至一年之后的预约时间。';$('#schedule-time').focus();throw new Error('请检查预约时间。')}return new Date(time).toISOString()}
function setEditorValues(campaign){const form=$('#mail-form');form.elements.subject.value=campaign.subject || '';form.elements.body.value=campaign.body || '';form.elements.audience.value=campaign.audience || 'all';form.elements.delivery.value='now';$('#schedule-time').value='';$('#editor-error').hidden=true;for(const key of ['subject','body','schedule'])$('#'+key+'-error').textContent='';for(const id of ['mail-subject','mail-body'])$('#'+id).removeAttribute('aria-invalid')}
function showMailMode(mode){$('#mail-list-view').hidden=mode!=='list';$('#mail-editor-view').hidden=mode!=='editor';$('#mail-detail-view').hidden=mode!=='detail';if(mode!=='detail')clearTimeout(progressTimer)}
async function protectEditor(){if(!editorDirty() || !editorFields().subject && !editorFields().body)return true;return confirmAction('放弃未保存的更改？','当前邮件有尚未保存的内容。返回编辑可先保存草稿。','放弃更改')}
async function newMail(prefill={}){if(state.mailBusy)return toast('请等待当前邮件操作完成。');if(!await protectEditor())return;setEditorValues(prefill);state.editor={id:'',saved:null,sig:editorSignature({subject:'',body:'',audience:'all'}),html:''};$('#preview-frame').hidden=true;$('#preview-frame').srcdoc='';$('#preview-placeholder').hidden=false;await navigate('mail',{load:false});showMailMode('editor');renderEditorStatus();$('#mail-subject').focus()}
async function openCampaign(id){if(state.mailBusy)return toast('请等待当前邮件操作完成。');if(!await protectEditor())return;const token=++state.detailToken,viewToken=state.viewToken;try{const {campaign}=await api('/api/admin/campaigns/'+encodeURIComponent(id));if(token!==state.detailToken || viewToken!==state.viewToken)return;await navigate('mail',{load:false});if(campaign.status!=='draft'){state.detailId=id;state.detail=campaign;showMailMode('detail');await loadDelivery();return}setEditorValues(campaign);state.editor={id,saved:campaign,sig:editorSignature(),html:''};showMailMode('editor');renderEditorStatus();await refreshEditorPreview()}catch(error){if(error.status!==401)toast(error.message,true)}}
function applyEditorPreview(data){if(data.campaign.id!==state.editor.id)return;state.editor.saved=data.campaign;state.editor.sig=editorSignature({subject:data.campaign.subject,body:data.campaign.body,audience:data.campaign.audience || 'all'});state.editor.html=data.html;state.editor.recipientCount=data.recipientCount;$('#preview-frame').srcdoc=data.html;$('#preview-frame').hidden=false;$('#preview-placeholder').hidden=true;renderEditorStatus()}
async function refreshEditorPreview(){const id=state.editor.id,data=await api('/api/admin/campaigns/'+encodeURIComponent(id)+'/preview');if(id!==state.editor.id)throw new Error('邮件已切换，请重新操作。');applyEditorPreview(data);return data}
async function saveDraft(){const fields=validateEditor(),id=state.editor.id;if(!id || editorDirty()){
  const saved=await api('/api/admin/campaigns'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',body:{...fields,...(state.editor.saved?.updated_at?{expectedUpdatedAt:state.editor.saved.updated_at}:{})}});state.editor.id=saved.id;
  const preview=await refreshEditorPreview();if(preview.campaign.status!=='draft')throw new Error('此邮件已开始发送，请返回列表查看投递记录。');return preview;
}return refreshEditorPreview()}
async function mailAction(button,operation,{dialog=false}={}){if(state.mailBusy)return;state.mailBusy=true;const oldText=button.innerHTML;$$('[data-mail-action]').forEach(b=>b.disabled=true);$$('#mail-form input,#mail-form textarea,#mail-form select').forEach(input=>input.disabled=true);button.textContent='处理中…';$('#editor-error').hidden=true;$('#review-error').textContent='';renderEditorStatus();try{return await operation()}catch(error){if(error.status!==401){if(dialog && $('#send-review').open)$('#review-error').textContent=error.message;else{$('#editor-error').textContent=error.message;$('#editor-error').hidden=false}toast(error.message,true)}}finally{state.mailBusy=false;button.innerHTML=oldText;$$('[data-mail-action]').forEach(b=>b.disabled=false);$$('#mail-form input,#mail-form textarea,#mail-form select').forEach(input=>input.disabled=false);$('#mail-form [aria-invalid="true"]')?.focus();renderEditorStatus();if($('#send-review').open)renderReview()}}
async function sendTest(){const config=await getMailConfig(true);if(!config.ready)throw new Error('发信服务尚未配置，请在“自动化”中查看服务状态。');const preview=await saveDraft();if(preview.campaign.status!=='draft')throw new Error('此邮件已开始发送，请查看投递记录。');await post('/api/admin/campaigns/'+encodeURIComponent(state.editor.id)+'/test');const data=await refreshEditorPreview();toast('测试邮件已提交至 '+(config.ownerEmail || '站长邮箱')+'。');return {data,config}}
async function prepareSend(){scheduledTime();const data=await saveDraft(),config=await getMailConfig(true);state.review={id:data.campaign.id,campaign:data.campaign,count:data.recipientCount,tested:data.campaign.test_status==='sent',scheduledAt:scheduledTime(),config};renderReview();$('#send-review').showModal()}
function renderReview(){const r=state.review;if(!r)return;$('#review-subject').textContent=r.campaign.subject;$('#review-audience').textContent=audiences[r.campaign.audience] || audiences.all;$('#review-count').textContent=number(r.count)+' 人';$('#review-time').textContent=r.scheduledAt?date(r.scheduledAt):'立即加入发送队列';$('#review-test').classList.toggle('good',r.tested && Boolean(r.count) && r.config.ready);
  let message,label;
  if(!r.config.ready){message='发信服务尚未配置。可前往自动化查看状态，草稿已保存。';label='查看发信设置'}
  else if(!r.count){message='该分组当前没有有效收件人。请更换分组，或在订阅者页查看订阅状态。';label='返回修改收件人'}
  else if(!r.tested){message='先给站长邮箱发送当前内容的测试信，完成后即可正式发送。';label='发送测试邮件给我'}
  else {message='当前内容的测试邮件已提交。请检查排版后确认发送。退订及停止投递的地址会被跳过。';label=r.scheduledAt?'确认预约给 '+number(r.count)+' 人':'确认发送给 '+number(r.count)+' 人'}
  $('#review-test').textContent=message;if(!state.mailBusy)$('#review-action').textContent=label;
}
async function reviewAction(){const r=state.review;if(!r)return;
  if(!r.config.ready){$('#send-review').close();await navigate('automation');return}
  if(!r.count){$('#send-review').close();$('#mail-audience').focus();return}
  if(!r.tested){const {data,config}=await sendTest();state.review={...r,campaign:data.campaign,count:data.recipientCount,tested:data.campaign.test_status==='sent',config};return}
  if(r.scheduledAt && Date.parse(r.scheduledAt)<Date.now()+30000)throw new Error('预约时间已临近或过期，请返回编辑重新选择时间。');
  const result=await post('/api/admin/campaigns/'+encodeURIComponent(r.id)+'/start',{confirmRecipientCount:r.count,expectedUpdatedAt:r.campaign.updated_at,scheduledAt:r.scheduledAt});
  $('#send-review').close();state.editor.saved={...r.campaign,status:result.status};state.editor.sig=editorSignature();state.detailId=r.id;state.detail=state.editor.saved;showMailMode('detail');toast(result.status==='scheduled'?'预约已保存，服务器将到时发送。':'已加入发送队列，关闭后台仍会继续。');await loadDelivery();await loadCampaigns();
}
async function loadDelivery(){const id=state.detailId;if(!id)return;const token=state.detailToken;const [data,preview]=await Promise.all([api('/api/admin/campaigns/'+encodeURIComponent(id)+'/progress'),api('/api/admin/campaigns/'+encodeURIComponent(id)+'/preview')]);if(state.view!=='mail' || $('#mail-detail-view').hidden || id!==state.detailId || token!==state.detailToken)return;state.detail=data.campaign;const c=data.campaign,p=data.progress;
  $('#detail-subject').textContent=c.subject;$('#detail-status').innerHTML=badge(c.status);$('#detail-meta').innerHTML=`<span>${esc(audiences[c.audience] || audiences.all)}</span><span>${c.kind==='release'?'自动版本通知':'手动邮件'}</span><span>${c.scheduled_at?'发送时间 '+esc(date(c.scheduled_at)):'创建于 '+esc(date(c.created_at))}</span>`;
  $('#delivery-stats').innerHTML=[['sent','已提交'],['pending','待发送'],['sending','发送中'],['retry_wait','待重试'],['failed','失败'],['bounced','退信'],['uncertain','待核实'],['skipped','跳过']].map(([key,label])=>`<div>${label}<b>${number(p[key])}</b></div>`).join('');
  $('#cancel-campaign').hidden=!['scheduled','queued'].includes(c.status);$('#cancel-campaign').textContent=c.status==='scheduled'?'取消预约':'取消发送';$('#retry-campaign').hidden=!data.recipients.some(row=>row.status==='failed' && row.retry_safe) && !(data.recipients.length===100 && p.failed);
  $('#delivery-note').textContent=c.status==='scheduled'?'预约时的收件名单已保存，新增订阅者不会加入本次预约。开始投递前仍会检查退订状态。':p.uncertain?'存在待核实的投递：提交后未取得明确回复，系统不会自动重发这些邮件。':'“已提交”表示发送服务接受邮件，不代表已经送达收件箱。';
  $('#delivery-rows').innerHTML=data.recipients.length?data.recipients.map(row=>`<tr><td>${esc(row.email)}</td><td>${badge(row.status)}</td><td>${number(row.attempts)} 次</td><td>${esc(row.next_attempt_at?date(row.next_attempt_at):row.sent_at?date(row.sent_at):'—')}</td><td>${esc(row.error_code || (row.last_stage==='accepted'?'发送服务已接受':'—'))}</td></tr>`).join(''):emptyRow(5,'没有投递名单');
  $('#attempt-list').innerHTML=data.attempts.length?data.attempts.map(row=>`<div class="attempt-item">${esc(date(row.created_at))} · ${esc(row.email)} · 第 ${number(row.attempt)} 次 · ${esc(deliveryNames[row.status] || row.status)}${row.error_code?' · '+esc(row.error_code):''}</div>`).join(''):'<p class="muted">尚无投递尝试记录。</p>';$('#detail-frame').srcdoc=preview.html;
  clearTimeout(progressTimer);if(p.pending || p.sending || p.retry_wait)progressTimer=setTimeout(()=>loadDelivery().catch(error=>{if(error.status!==401)pageError(error)}),c.status==='scheduled'?60000:15000);
}
async function cancelCampaign(button){const id=state.detailId,label=state.detail?.status==='scheduled'?'取消预约':'取消发送';if(!await confirmAction(label+'？','尚未开始的投递将被取消。邮件内容和历史记录会保留，可复制为新邮件。',label))return;await buttonAction(button,async()=>{await post('/api/admin/campaigns/'+encodeURIComponent(id)+'/cancel');toast('尚未开始的投递已取消。');await loadDelivery();await loadCampaigns()})}
async function buttonAction(button,operation){if(button.disabled)return;const label=button.innerHTML;button.disabled=true;button.textContent='处理中…';try{await operation()}catch(error){if(error.status!==401)toast(error.message,true)}finally{button.disabled=false;button.innerHTML=label}}
// Navigation uses the current view token; late responses cannot replace another page.
$$('.nav [data-view]').forEach(button=>button.onclick=()=>navigate(button.dataset.view));
document.addEventListener('click',async event=>{const target=event.target.closest('[data-new-mail],[data-goto],[data-open-campaign],[data-stop-subscriber],[data-restore-email]');if(!target)return;
  if(target.hasAttribute('data-new-mail'))return newMail();
  if(target.dataset.goto)return navigate(target.dataset.goto);
  if(target.dataset.openCampaign)return openCampaign(target.dataset.openCampaign);
  if(target.dataset.stopSubscriber){if(!await confirmAction('停止向此邮箱发信？',target.dataset.email+'\n之后的更新邮件和感谢邮件都会跳过这个地址。','停止发信'))return;return buttonAction(target,async()=>{await api('/api/admin/subscribers/'+encodeURIComponent(target.dataset.stopSubscriber),{method:'PATCH',body:{action:'unsubscribe'}});toast('已停止向该邮箱发送后续邮件。');await loadSubscribers()})}
  if(target.dataset.restoreEmail){const email=target.dataset.restoreEmail;if(!await confirmAction('解除退信抑制？',email+'\n请确认退信原因已解决。解除后恢复后续投递资格，订阅状态保持原样，不会补发历史邮件。','解除抑制'))return;return buttonAction(target,async()=>{await post('/api/admin/bounces/restore',{email,confirmEmail:email});toast('已解除抑制。');await loadAutomation()})}
});
$('#refresh').onclick=()=>loadCurrent();$('#retry-load').onclick=()=>loadCurrent();
$('#mail-search').addEventListener('input',renderCampaigns);$('#mail-filters').onclick=event=>{const button=event.target.closest('[data-filter]');if(!button)return;state.mailFilter=button.dataset.filter;$$('#mail-filters button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderCampaigns()};
$$('[data-mail-back]').forEach(button=>button.onclick=()=>{if(state.mailBusy)return toast('请等待当前邮件操作完成。');showMailMode('list');loadCampaigns().catch(pageError);if(editorDirty() && (editorFields().subject || editorFields().body))toast('未保存的内容仍保留在编辑器中。点击“继续编辑”可返回。');$('#resume-editor').hidden=!(editorDirty() && (editorFields().subject || editorFields().body))});
$('#resume-editor').onclick=()=>{showMailMode('editor');renderEditorStatus()};
$('#mail-form').addEventListener('input',()=>{renderEditorStatus();$('#editor-error').hidden=true;for(const key of ['subject','body'])if(editorFields()[key]){$('#'+key+'-error').textContent='';$('#mail-'+key).removeAttribute('aria-invalid')}});
$('#mail-form').addEventListener('change',renderEditorStatus);$('#mail-form').onsubmit=event=>{event.preventDefault();$('#prepare-send').click()};
$('#save-mail').onclick=()=>mailAction($('#save-mail'),async()=>{await saveDraft();toast('草稿已保存。');await loadCampaigns()});
$('#preview-mail').onclick=()=>mailAction($('#preview-mail'),()=>saveDraft());$('#test-mail').onclick=()=>mailAction($('#test-mail'),()=>sendTest());$('#prepare-send').onclick=()=>mailAction($('#prepare-send'),()=>prepareSend());
$('#review-action').onclick=()=>mailAction($('#review-action'),()=>reviewAction(),{dialog:true});
$$('[data-close-review]').forEach(button=>button.onclick=()=>{if(!state.mailBusy)$('#send-review').close()});$('#send-review').addEventListener('cancel',event=>{if(state.mailBusy)event.preventDefault()});
$('#refresh-delivery').onclick=()=>buttonAction($('#refresh-delivery'),()=>loadDelivery());$('#cancel-campaign').onclick=()=>cancelCampaign($('#cancel-campaign'));
$('#retry-campaign').onclick=()=>buttonAction($('#retry-campaign'),async()=>{const r=await post('/api/admin/campaigns/'+encodeURIComponent(state.detailId)+'/retry');toast('已安排 '+number(r.retried)+' 个失败地址重试。');await loadDelivery()});
$('#duplicate-mail').onclick=()=>{if(state.detail)newMail({subject:state.detail.subject,body:state.detail.body,audience:state.detail.audience})};
$('#subscriber-filters').onsubmit=event=>{event.preventDefault();state.page=1;loadSubscribers().catch(pageError)};
$('#reset-subscribers').onclick=()=>{$('#subscriber-filters').reset();state.page=1;loadSubscribers().catch(pageError)};
$('#previous-page').onclick=()=>{if(state.page>1){state.page--;loadSubscribers().catch(pageError)}};$('#next-page').onclick=()=>{if(state.page*50<state.subscriberTotal){state.page++;loadSubscribers().catch(pageError)}};
$('#export-subscribers').onclick=()=>buttonAction($('#export-subscribers'),async()=>{const response=await api('/api/admin/export?'+subscriberQuery(),{raw:true}),blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='musefilm-subscribers.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出当前筛选结果。')});
$('#activity-tabs').onclick=event=>{const button=event.target.closest('[data-activity]');if(!button)return;state.activity=button.dataset.activity;$$('#activity-tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));$('#activity-search').value='';renderActivity();loadActivity().catch(pageError)};$('#activity-search').addEventListener('input',renderActivity);
$('#feedback-list').addEventListener('change',async event=>{const select=event.target.closest('[data-feedback-status]');if(!select)return;const row=state.feedback.find(item=>item.id===select.dataset.feedbackStatus);if(!row)return;const previous=row.status,status=select.value;select.disabled=true;try{await api('/api/admin/feedback/'+encodeURIComponent(row.id),{method:'PATCH',body:{status}});row.status=status;renderActivity();toast('反馈状态已更新。')}catch(error){select.value=previous;toast(error.message,true)}finally{select.disabled=false}});
$('#automation-form').addEventListener('change',renderSettingsSave);
$('#automation-form').onsubmit=event=>{event.preventDefault();if(!state.settingsSig)return toast('请等待自动化设置加载完成。',true);const values=settingsValues(),signature=JSON.stringify(values);buttonAction($('#save-settings'),async()=>{await api('/api/admin/automation',{method:'PATCH',body:values});state.settingsSig=signature;toast('自动化设置已保存。');await loadAutomation()})};
for(const [id,path,message] of [['check-releases','check','版本检查完成。'],['check-imap','imap','IMAP 连接与退信检查完成。']])$('#'+id).onclick=()=>buttonAction($('#'+id),async()=>{try{const result=await post('/api/admin/automation/'+path);toast(result.busy?'已有检查在运行，请稍后刷新。':result.baseline?'已建立当前版本基线，没有补发历史邮件。':message)}finally{await loadAutomation()}});
$('#request-code').onclick=()=>buttonAction($('#request-code'),async()=>{const data=await post('/api/admin/login/request');state.challengeId=data.challengeId;$('#login-message').textContent='验证码已发送，请查看站长邮箱。';$('#login-message').style.color='var(--green)';$('#login-code').focus();setTimeout(()=>{let remaining=60;$('#request-code').disabled=true;$('#request-code').textContent=remaining+' 秒后重发';clearInterval(loginTimer);loginTimer=setInterval(()=>{remaining--;$('#request-code').textContent=remaining+' 秒后重发';if(remaining<=0){clearInterval(loginTimer);$('#request-code').disabled=false;$('#request-code').textContent='获取验证码'}},1000)},0)});
$('#login-form').onsubmit=async event=>{event.preventDefault();$('#login-message').style.color='var(--red)';const code=$('#login-code').value.trim();if(!state.challengeId){$('#login-message').textContent='请先点击“获取验证码”。';return}if(!/^\d{8}$/.test(code)){$('#login-message').textContent='请输入 8 位数字验证码。';return}await buttonAction($('#login-submit'),async()=>{try{await post('/api/admin/login',{challengeId:state.challengeId,code});$('#login-code').value='';await boot()}catch(error){$('#login-message').textContent=error.message}})};
$('#logout').onclick=async()=>{if(editorDirty() && (editorFields().subject || editorFields().body) && !await confirmAction('退出登录？','当前页面的未保存邮件内容将被保留，重新登录后可继续编辑。','退出登录'))return;await buttonAction($('#logout'),async()=>{await post('/api/admin/logout');showLogin();state.challengeId='';state.mailConfig=null})};
window.addEventListener('beforeunload',event=>{if(editorDirty() && (editorFields().subject || editorFields().body) || settingsDirty()){event.preventDefault();event.returnValue=''}});
async function boot(){try{await api('/api/admin/session');$('#login').hidden=true;$('#dashboard').hidden=false;await Promise.all([getMailConfig(true),loadOverview(-1)]);const hash=location.hash.slice(1),view=names[hash]?hash:state.view;await navigate(view)}catch(error){if(error.status!==401)showLogin(error.message)}}
$$('#automation-form input,#save-settings').forEach(control=>control.disabled=true);state.editor.sig=editorSignature();$('#timezone-label').textContent='按本地时区 '+(Intl.DateTimeFormat().resolvedOptions().timeZone || '')+' 保存，关闭后台仍会到时发送。';
boot();
