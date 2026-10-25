// The website session authorizes this fixed service-binding proxy. The membership
// administrator credential remains a Worker Secret and is never sent to a browser.
const membershipOperations=new Set(['payments/overview','payments/settings','payments/retry','codes/create','codes/list','codes/export','codes/disable','accounts','accounts/detail','accounts/grant','accounts/revoke','accounts/status','gifts/list','gifts/review','exchange/reports','exchange/preview','exchange/review']);
export async function membershipAdmin(request,env){
  const prefix='/api/admin/membership/',path=new URL(request.url).pathname;
  if(!path.startsWith(prefix))return null;
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  const action=path.slice(prefix.length);
  if(request.method!=='POST'||!membershipOperations.has(action))return reply({ok:false,error:'not_found'},404);
  if(!env.MEMBERSHIP||!env.MEMBERSHIP_ADMIN_TOKEN)return reply({ok:false,error:'会员后台连接尚未配置。'},503);
  if(Number(request.headers.get('content-length')||0)>8192)return reply({ok:false,error:'请求内容过大。'},413);
  const body=await request.text();if(new TextEncoder().encode(body).length>8192)return reply({ok:false,error:'请求内容过大。'},413);
  try{JSON.parse(body)}catch{return reply({ok:false,error:'请求内容无效。'},400)}
  let response;
  try{response=await env.MEMBERSHIP.fetch(new Request('https://membership.internal/v1/admin/'+action,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.MEMBERSHIP_ADMIN_TOKEN},body,signal:AbortSignal.timeout(30000)}))}catch{return reply({ok:false,error:'会员服务连接暂不可用，请稍后重试。'},503)}
  if(response.status===403)return reply({ok:false,error:'会员后台连接授权异常，请检查服务端配置。'},502);
  let data;try{data=await response.json()}catch{return reply({ok:false,error:'会员服务返回异常。'},502)}
  return reply({...data,ok:response.ok},response.status);
}
