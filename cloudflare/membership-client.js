const memberTitles={plus:'Plus',pro:'Pro',bookDocument:'成册券',bookMotion:'影像券',legacy:'历史订单'};
const memberStates={pending:'待发送',sending:'发送中',sent:'已提交',failed:'发送失败',uncertain:'待核实',historical:'历史记录',gift:'零元兑换',paused:'已暂停',available:'可领取',claimed:'已兑换',disabled:'已作废',expired:'已过期',approved:'已关联',rejected:'已拒绝'};
let memberAccount=null,memberAccountLoad=0;
let memberTab='orders',memberData=null,memberDelivery=null,memberCreateId=null,memberReview=null,memberLoad=0;
const memberDate=n=>n?date(n*1000):'—';
const memberApi=(path,body={})=>post('/api/admin/membership/'+path,body);
const memberTone=s=>['sent','approved','claimed'].includes(s)?'good':['failed','uncertain','disabled','rejected'].includes(s)?'bad':'wait';
const memberBadge=s=>`<span class="badge ${memberTone(s)}">${esc(memberStates[s]||s)}</span>`;
function renderMemberOverview(data){memberData=data;$('#member-total').textContent=number(data.accounts);$('#member-active').textContent=number(data.activeMembers);$('#member-amount').textContent='¥'+(data.totals.amountFen/100).toLocaleString('zh-CN',{minimumFractionDigits:2});$('#member-attention').textContent=number(data.totals.attention);$('#member-mail-config').textContent=(data.settings.mailReady?'邮件服务已配置':'邮件服务尚未就绪')+' · '+(data.settings.ownerEmail||'未配置收件邮箱')+' · 自 '+memberDate(data.settings.enabledAt)+' 起';$('#member-notifications').disabled=false;$('#member-notifications').textContent=data.settings.enabled?'暂停到账提醒':'开启到账提醒';$('#member-orders').innerHTML=data.rows.map(r=>`<tr><td class="break"><strong>${esc(r.order_id)}</strong><small>${esc(r.email||'尚未关联账号')}</small></td><td>${esc(memberTitles[r.product]||r.product)}<small>${r.amount_fen===null?'金额未提供':'¥'+(r.amount_fen/100).toFixed(2)}</small></td><td>${esc(memberDate(r.first_seen_at))}</td><td>${r.revoked?'已撤销':r.checkout_state==='credited'?'已到账':r.checkout_state==='verified'?'已核验，待同步':r.email?'已关联，查看账号有效期':'待关联账号'}</td><td>${memberBadge(r.notification_status)}<small>${esc(r.error_code||'')}</small></td><td>${['failed','uncertain'].includes(r.notification_status)?`<button class="small" data-member-retry="${esc(r.order_id)}" data-uncertain="${r.notification_status==='uncertain'}">重试邮件</button>`:'—'}</td></tr>`).join('')||emptyRow(6,'尚无充值记录','真实订单核验后会自动显示。')}
async function loadMembership(){const seq=++memberLoad,viewToken=state.viewToken;const data=await memberApi('payments/overview');if(seq!==memberLoad||viewToken!==state.viewToken||state.view!=='membership')return;renderMemberOverview(data);await loadMemberTab()}
async function loadMemberTab(){const tab=memberTab,seq=++memberLoad,viewToken=state.viewToken;$$('[data-member-panel]').forEach(p=>p.hidden=p.dataset.memberPanel!==tab);$$('[data-member-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.memberTab===tab)));if(tab==='orders')return;
 const data=await memberApi(tab==='codes'?'codes/list':tab==='gifts'?'gifts/list':tab==='reports'?'exchange/reports':'accounts',tab==='accounts'?{query:$('#member-search').elements.query.value}:{});if(seq!==memberLoad||viewToken!==state.viewToken||state.view!=='membership')return;
 if(tab==='reports')$('#member-reports').innerHTML=data.reports.map(r=>`<tr><td class="break">${esc(r.nickname)}<small>${esc(r.caption)}</small></td><td class="break">${esc(r.reason)}</td><td>${esc(memberDate(r.createdAt))}</td><td>${esc(({open:'待处理',dismiss:'已忽略',hide:'已移除',block:'已暂停漂流'})[r.status]||r.status)}</td><td><button class="small" data-member-preview="${esc(r.id)}">查看副本</button> ${r.status==='open'?`<button class="small" data-member-moderate="${esc(r.id)}" data-member-action="dismiss">忽略</button> <button class="small danger" data-member-moderate="${esc(r.id)}" data-member-action="hide">移除副本</button> <button class="small danger" data-member-moderate="${esc(r.id)}" data-member-action="block">暂停漂流</button>`:''}</td></tr>`).join('')||emptyRow(5,'暂无底片漂流举报');
 if(tab==='codes')$('#member-batches').innerHTML=data.batches.map(b=>`<tr><td>${esc(b.label||b.id.slice(0,8))}</td><td>${esc(memberTitles[b.product])} / ${number(b.durationDays)} 天</td><td>${number(b.count)} / ${number(b.claimed)} / ${number(b.disabled)}</td><td>${esc(memberDate(b.expiresAt))}</td><td><button class="small" data-member-export="${esc(b.id)}">查看 / 导出</button></td></tr>`).join('')||emptyRow(5,'暂无兑换码批次');
 if(tab==='accounts')$('#member-accounts').innerHTML=data.accounts.map(a=>`<tr><td>${esc(a.nickname||'光影旅人')}<small>${esc(a.email)}</small></td><td>${esc(memberDate(a.createdAt))}</td><td>${a.bannedAt!=null?'<span class="badge bad">已封禁</span>':esc(memberTitles[a.tier]||'基础版')}<small>${a.memberExpiresAt>=253402300799?'永久会员':esc(memberDate(a.memberExpiresAt))}${a.manualCount?' · 含手动授予':''}</small></td><td>${number(a.redemptions)}</td><td><button class="small" data-member-account="${esc(a.id)}">管理账号</button></td></tr>`).join('')||emptyRow(5,'没有匹配的账号');
 if(tab==='gifts'){$('#member-gifts').innerHTML=data.requests.map(g=>`<tr><td>${esc(g.nickname||'光影旅人')}<small>${esc(g.email)}</small></td><td>${esc(g.providerUserId)}</td><td>${esc(g.orderId)}<small>${esc(memberTitles[g.tier])}</small></td><td>${memberBadge(g.status)}</td><td>${g.status==='pending'?`<button class="small" data-member-review="${esc(g.id)}">核验关联</button> <button class="small danger" data-member-reject="${esc(g.id)}">拒绝</button>`:'—'}</td></tr>`).join('')||emptyRow(5,'没有关联申请');memberData.gifts=data.requests;}
}
const memberAvailableCodes=()=>memberDelivery?.codes.filter(c=>c.status==='available').map(c=>c.code)||[];
const memberCodeList=()=>memberAvailableCodes().map((code,index)=>$('#member-code-numbered').checked?(index+1)+'. '+code:code).join('\n');
function renderMemberCodeList(){const codes=memberAvailableCodes();$('#member-code-list').value=memberCodeList();$('#member-code-count').textContent='可用 '+codes.length+' 个 · 每行一个兑换码'+($('#member-code-numbered').checked?'，复制及 TXT 导出包含序号。':'，复制及 TXT 导出为纯码。');$('#member-copy').disabled=$('#member-txt').disabled=!codes.length;}
function renderMemberDelivery(data){
 memberDelivery=data;
 $('#member-delivery').hidden=false;$('#member-delivery-title').textContent=(data.batch.label||'本批兑换码')+' · '+memberTitles[data.batch.product];
 renderMemberCodeList();
 $('#member-codes').innerHTML=data.codes.map(c=>`<tr><td><code style="user-select:all">${esc(c.code)}</code></td><td>${memberBadge(c.status)}</td><td><button class="small" data-member-code="${esc(c.id)}">复制兑换码</button> <button class="small" data-member-link="${esc(c.id)}">复制领取链接</button> ${c.status==='available'?`<button class="small danger" data-member-disable="${esc(c.id)}">作废</button>`:''}</td></tr>`).join('');
}
$('#member-tabs').onclick=event=>{const b=event.target.closest('[data-member-tab]');if(b){memberTab=b.dataset.memberTab;loadMemberTab().catch(pageError)}};
$('#member-reload').onclick=()=>buttonAction($('#member-reload'),loadMembership);
$('#member-notifications').onclick=()=>buttonAction($('#member-notifications'),async()=>{await memberApi('payments/settings',{enabled:!memberData.settings.enabled});await loadMembership();toast('充值到账提醒设置已保存。')});
$('#member-search').onsubmit=event=>{event.preventDefault();loadMemberTab().catch(pageError)};
$('#member-create').oninput=()=>memberCreateId=null;
$('#member-create').onsubmit=event=>{event.preventDefault();const f=event.currentTarget;buttonAction(f.querySelector('button[type=submit]'),async()=>{memberCreateId=memberCreateId||crypto.randomUUID();const data=await memberApi('codes/create',{batchId:memberCreateId,product:f.elements.product.value,count:Number(f.elements.count.value),durationDays:Number(f.elements.durationDays.value),validDays:Number(f.elements.validDays.value),label:f.elements.label.value});memberCreateId=null;renderMemberDelivery(data);await loadMemberTab();toast('兑换码已生成，可复制带序号的列表或导出 TXT、CSV。')})};
$('#member-code-numbered').onchange=renderMemberCodeList;
$('#member-copy').onclick=()=>buttonAction($('#member-copy'),async()=>{const codes=memberAvailableCodes();if(!codes.length)return;await navigator.clipboard.writeText(memberCodeList());toast('已复制 '+codes.length+' 个可用兑换码，每行一个。')});
$('#member-txt').onclick=()=>{if(!memberAvailableCodes().length)return;const url=URL.createObjectURL(new Blob([memberCodeList()+'\n'],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='MuseFilm-'+memberDelivery.batch.id+'-codes.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('#member-csv').onclick=()=>{if(!memberDelivery)return;const safe=v=>'"'+String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';const rows=[['兑换码','产品','天数','领取截止','状态','领取链接'],...memberDelivery.codes.map(c=>[c.code,memberTitles[memberDelivery.batch.product],memberDelivery.batch.durationDays,memberDate(memberDelivery.batch.expiresAt),memberStates[c.status],c.redeemURL])];const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='MuseFilm-'+memberDelivery.batch.id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('#view-membership').addEventListener('click',async event=>{const b=event.target.closest('[data-member-account],[data-member-export],[data-member-code],[data-member-link],[data-member-disable],[data-member-retry],[data-member-review],[data-member-reject],[data-member-preview],[data-member-moderate]');if(!b)return;return buttonAction(b,async()=>{
 if(b.dataset.memberAccount)await openMemberAccount(b.dataset.memberAccount);
 if(b.dataset.memberPreview){const data=await memberApi('exchange/preview',{reportId:b.dataset.memberPreview});$('#member-report-image').src=data.imageData;$('#member-report-preview').showModal()}
 if(b.dataset.memberModerate){const action=b.dataset.memberAction;if(!await confirmAction('处理这条底片举报？',action==='block'?'移除该副本并暂停分享者后续的底片漂流，账号和会员权益保持有效。':action==='hide'?'移除该副本，已保存到用户本机的文件无法撤回。':'将举报标记为已核查，不移除副本。','确认处理'))return;await memberApi('exchange/review',{reportId:b.dataset.memberModerate,action});await loadMemberTab();toast('举报处理已保存。')}
 if(b.dataset.memberExport)renderMemberDelivery(await memberApi('codes/export',{batchId:b.dataset.memberExport}));
 if(b.dataset.memberCode){await navigator.clipboard.writeText(memberDelivery.codes.find(c=>c.id===b.dataset.memberCode).code);toast('兑换码已复制。')}
 if(b.dataset.memberLink){await navigator.clipboard.writeText(memberDelivery.codes.find(c=>c.id===b.dataset.memberLink).redeemURL);toast('领取链接已复制。')}
 if(b.dataset.memberDisable&&await confirmAction('作废这个兑换码？','仅限未领取的兑换码，已兑换会员不会被撤销。','作废')){await memberApi('codes/disable',{codeId:b.dataset.memberDisable});renderMemberDelivery(await memberApi('codes/export',{batchId:memberDelivery.batch.id}));await loadMemberTab()}
 if(b.dataset.memberRetry){const uncertain=b.dataset.uncertain==='true';if(!await confirmAction('重新提交到账邮件？',uncertain?'此前邮件可能已到达。请先核对收件箱，重发可能产生重复邮件。':'将向已配置的站长邮箱重试这一笔充值提醒。','确认重试'))return;await memberApi('payments/retry',{orderId:b.dataset.memberRetry,confirmDuplicateRisk:uncertain});await loadMembership();toast('已安排重试，稍后刷新查看投递状态。')}
 if(b.dataset.memberReview){memberReview=memberData.gifts.find(g=>g.id===b.dataset.memberReview);$('#member-review-summary').textContent=memberReview.email+' ↔ '+memberReview.providerUserId+' · '+memberReview.orderId;$('#member-review-form').reset();$('#member-review-dialog').showModal()}
 if(b.dataset.memberReject&&await confirmAction('拒绝此关联申请？','用户现有的会员权益不会被撤销。','拒绝申请')){await memberApi('gifts/review',{requestId:b.dataset.memberReject,action:'reject'});await loadMemberTab()}
})});
$('#member-review-cancel').onclick=()=>$('#member-review-dialog').close();
$('#member-review-form').onsubmit=event=>{event.preventDefault();buttonAction(event.currentTarget.querySelector('button[type=submit]'),async()=>{await memberApi('gifts/review',{requestId:memberReview.id,action:'approve',bindingCode:$('#member-review-code').value.trim(),identityConfirmed:$('#member-review-confirm').checked});$('#member-review-dialog').close();await loadMemberTab();toast('账号关联与会员核验已完成。')})};
window.addEventListener('pagehide',clearMemberData);

function clearMemberData(){closeMemberAccount();memberLoad++;memberData=null;memberDelivery=null;memberReview=null;for(const id of ["member-codes","member-orders","member-batches","member-accounts","member-gifts","member-reports"])$("#"+id).replaceChildren();$('#member-code-list').value='';$('#member-code-count').textContent='';$('#member-copy').disabled=$('#member-txt').disabled=true;$("#member-delivery").hidden=true;}

const memberManagementTitles={admin_membership_granted:'授予会员',admin_membership_revoked:'取消手动授予',account_banned:'封禁账号',account_unbanned:'解除封禁'};
function renderMemberAccount(data){
 memberAccount=data;const a=data.account,banned=a.bannedAt!=null;
 $('#member-account-title').textContent=(a.nickname||'光影旅人')+' · 账号管理';$('#member-account-email').textContent=a.email;
 $('#member-account-state').textContent=banned?'已封禁 · '+memberDate(a.bannedAt):'账号正常 · 当前权益：'+(memberTitles[a.tier]||'基础版');
 $('#member-account-ban-reason').textContent=banned?'封禁原因：'+a.banReason:'';
 $('#member-account-status').textContent=banned?'解除封禁':'封禁账号';$('#member-grant-submit').disabled=banned;
 $('#member-account-grants').innerHTML=data.grants.map(g=>`<tr><td>${esc(memberTitles[g.tier])}</td><td>${g.permanent?'永久会员':esc(memberDate(g.expiresAt))}</td><td>${esc(({manual:'手动授予',afdian:'爱发电',code:'兑换码'})[g.provider]||g.provider)}<small>${g.revoked?'已取消':g.active?'有效':'已过期'}</small></td><td>${g.provider==='manual'&&!g.revoked?`<button type="button" class="small danger" data-member-revoke="${esc(g.tier)}">取消手动授予</button>`:'—'}</td></tr>`).join('')||emptyRow(4,'暂无会员权益');
 $('#member-account-history').innerHTML=data.history.map(h=>`<p>${esc(memberDate(h.createdAt))} · ${esc(memberManagementTitles[h.kind]||h.kind)}${h.tier?' '+esc(memberTitles[h.tier]):''}${h.kind==='admin_membership_granted'?' · '+(h.permanent?'永久':esc(memberDate(h.expiresAt))):''}<br>${esc(h.reason||'')}</p>`).join('')||'暂无管理操作。';
}
async function openMemberAccount(accountId){
 const seq=++memberAccountLoad,viewToken=state.viewToken;
 const data=await memberApi('accounts/detail',{accountId});
 if(seq!==memberAccountLoad||viewToken!==state.viewToken||state.view!=='membership')return;
 $('#member-account-form').reset();$('#member-grant-days').disabled=false;$('#member-grant-duration').hidden=false;
 renderMemberAccount(data);$('#member-account-dialog').showModal();
}
function closeMemberAccount(){memberAccountLoad++;memberAccount=null;if($('#member-account-dialog').open)$('#member-account-dialog').close();for(const id of ['member-account-title','member-account-email','member-account-state','member-account-ban-reason','member-account-grants','member-account-history'])$('#'+id).replaceChildren();$('#member-account-reason').value='';}
function memberManagementBody(){
 if(!memberAccount)throw new Error('请重新打开账号资料。');
 const reason=$('#member-account-reason').value.trim();if(!reason)throw new Error('请先填写操作原因。');
 return {accountId:memberAccount.account.id,expectedRevision:memberAccount.account.revision,reason};
}
async function saveMemberManagement(action,body){
 const seq=memberAccountLoad,viewToken=state.viewToken;
 let data;try{data=await memberApi('accounts/'+action,body)}catch(error){if(error.status===409&&seq===memberAccountLoad&&memberAccount?.account.id===body.accountId)renderMemberAccount(await memberApi('accounts/detail',{accountId:body.accountId}));throw error}
 if(seq!==memberAccountLoad||viewToken!==state.viewToken||state.view!=='membership')return;
 renderMemberAccount(data);$('#member-account-reason').value='';await loadMembership();toast('账号管理操作已保存。');
}
$('#member-account-close').onclick=closeMemberAccount;
$('#member-account-dialog').addEventListener('cancel',event=>{event.preventDefault();closeMemberAccount()});
$('#member-grant-permanent').onchange=()=>{const permanent=$('#member-grant-permanent').checked;$('#member-grant-duration').hidden=permanent;$('#member-grant-days').disabled=permanent;};
$('#member-account-form').onsubmit=event=>{event.preventDefault();buttonAction($('#member-grant-submit'),async()=>{
 const body={...memberManagementBody(),tier:$('#member-grant-tier').value,permanent:$('#member-grant-permanent').checked,durationDays:Number($('#member-grant-days').value)};
 if(!await confirmAction('授予 '+memberTitles[body.tier]+' 会员？',memberAccount.account.email+' · '+(body.permanent?'永久会员':body.durationDays+' 天')+'。将替换同档位的手动授予，其他权益保留。','确认授予'))return;
 await saveMemberManagement('grant',body);
})};
$('#member-account-grants').addEventListener('click',event=>{const b=event.target.closest('[data-member-revoke]');if(!b)return;buttonAction(b,async()=>{
 const body={...memberManagementBody(),tier:b.dataset.memberRevoke};
 if(!await confirmAction('取消 '+memberTitles[body.tier]+' 手动授予？',memberAccount.account.email+' 的该档手动赠送将失效，购买及兑换权益继续保留。','取消授予'))return;
 await saveMemberManagement('revoke',body);
})});
$('#member-account-status').onclick=async()=>{await buttonAction($('#member-account-status'),async()=>{
 const body={...memberManagementBody(),banned:memberAccount.account.bannedAt==null};
 if(!await confirmAction(body.banned?'封禁此账号？':'解除账号封禁？',memberAccount.account.email+' · '+(body.banned?'立即注销服务端会话并阻止再次登录；离线缓存授权可能暂时保留。':'允许重新登录，原有未过期权益恢复可用。'),body.banned?'封禁账号':'解除封禁'))return;
 await saveMemberManagement('status',body);
});if(memberAccount)renderMemberAccount(memberAccount)};

$('#member-report-close').onclick=()=>{$('#member-report-preview').close();$('#member-report-image').removeAttribute('src')};
