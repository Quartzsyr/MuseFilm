// Safe Markdown images for campaign previews, plain-text fallbacks and QQ MIME.
// No raw HTML is accepted. Only public MuseFilm resources are fetched by the Worker.
const EMAIL_IMAGE_LIMIT = 6;
const EMAIL_IMAGE_BYTES = 3 * 1024 * 1024;
const EMAIL_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;
const emailImagePattern = () => /!\[([^\]\r\n]{0,300})\]\((https:\/\/[^\s<>]+?)\)/gi;

function emailImageUrl(value) {
  if(typeof value!=='string' || value.length>2048 || /[\s<>\\\u0000-\u001f]/.test(value))return null;
  try {
    const u=new URL(value),host=u.hostname.toLowerCase();
    if(u.protocol!=='https:' || u.username || u.password || u.port && u.port!=='443' || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /(?:^|\.)(?:localhost|local|internal|test|invalid|lan|home)$/.test(host) || /\.(?:svg|html?|js)$/i.test(u.pathname))return null;
    u.hash='';return u.href;
  }catch{return null}
}

function trustedEmailImage(value) {
  const safe=emailImageUrl(value);if(!safe)return false;
  const u=new URL(safe),h=u.hostname.toLowerCase();
  if(['musefilm.top','www.musefilm.top'].includes(h))return true;
  if(h==='github.com')return /^\/Quartzsyr\/MuseFilm\/releases\/download\/[^/]+\/[^/]+$/i.test(u.pathname);
  if(h==='raw.githubusercontent.com')return /^\/Quartzsyr\/MuseFilm\//i.test(u.pathname);
  return ['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(h);
}

function emailInlineText(value) {
  // Escape first: Markdown never provides a route for arbitrary attributes/HTML.
  return escapeHtml(value).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`\n]+)`/g,'<code>$1</code>')
    .replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g,(match,label,url)=>{
      const safe=emailImageUrl(url.replace(/&amp;/g,'&'));return safe?`<a href="${escapeHtml(safe)}" style="color:#d4b69a">${label}</a>`:match;
    });
}

function campaignBodyContent(body) {
  const source=String(body || '').slice(0,20000),html=[],plain=[],images=[];
  let cursor=0;
  const prose=value=>{
    if(!value.trim())return;
    for(const part of value.split(/\n\s*\n/)) {
      if(!part.trim())continue;
      html.push(`<p style="color:#c4bfb7;font-size:15px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere">${emailInlineText(part.trim())}</p>`);
      plain.push(part.trim().replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,'$1（$2）'));
    }
  };
  for(const match of source.matchAll(emailImagePattern())) {
    prose(source.slice(cursor,match.index));cursor=match.index+match[0].length;
    const url=emailImageUrl(match[2]),alt=match[1].trim() || 'MuseFilm 功能预览';
    if(!url){prose(match[0]);continue}
    plain.push(`图片：${alt}\n${url}`);
    if(images.length>=EMAIL_IMAGE_LIMIT){html.push(`<p style="font-size:13px"><a href="${escapeHtml(url)}" style="color:#d4b69a">查看图片：${escapeHtml(alt)}</a></p>`);continue}
    images.push({url,alt});
    html.push(`<div style="margin:24px 0"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" width="532" referrerpolicy="no-referrer" style="display:block;width:100%;max-width:532px;height:auto;border:0;border-radius:12px;background:#242321"><p style="margin:9px 0 0;color:#a49b8e;font-size:12px;line-height:1.6">${escapeHtml(alt)}</p></div>`);
  }
  prose(source.slice(cursor));
  return {html:html.join(''),text:plain.join('\n\n'),images};
}

async function readEmailImage(response,signal) {
  if(Number(response.headers.get('Content-Length'))>EMAIL_IMAGE_BYTES){await response.body?.cancel();throw new Error('IMAGE_TOO_LARGE')}
  const reader=response.body?.getReader();if(!reader)throw new Error('NO_IMAGE_BODY');
  const chunks=[];let length=0,complete=false;
  try {
    while(true){if(signal.aborted)throw new Error('IMAGE_TIMEOUT');const {done,value}=await reader.read();if(done){complete=true;break}length+=value.byteLength;if(length>EMAIL_IMAGE_BYTES)throw new Error('IMAGE_TOO_LARGE');chunks.push(value)}
  }finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock()}
  if(!length)throw new Error('EMPTY_IMAGE');
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes;
}

function emailImageType(bytes) {
  if(bytes.length>=8 && [137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return 'image/png';
  if(bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'image/jpeg';
  const head=new TextDecoder().decode(bytes.slice(0,12));
  if(/^GIF8[79]a/.test(head))return 'image/gif';
  if(head.startsWith('RIFF') && head.slice(8)==='WEBP')return 'image/webp';
  return null;
}

async function prepareInlineEmailImages(message,fetcher=fetch) {
  const attachments=[],seen=new Set(),signal=AbortSignal.timeout(8000);let total=0,html=String(message.html || '');
  for(const image of (message.emailImages || []).slice(0,EMAIL_IMAGE_LIMIT)) {
    if(signal.aborted)break;
    if(!trustedEmailImage(image.url) || seen.has(image.url))continue;seen.add(image.url);
    try {
      let url=image.url,response;
      for(let redirects=0;redirects<=3;redirects++) {
        if(!trustedEmailImage(url))throw new Error('UNTRUSTED_IMAGE_REDIRECT');
        response=await fetcher(url,{redirect:'manual',headers:{Accept:'image/png,image/jpeg,image/gif,image/webp'},signal});
        if(![301,302,303,307,308].includes(response.status))break;
        const location=response.headers.get('Location');await response.body?.cancel();
        if(!location || redirects===3)throw new Error('IMAGE_REDIRECT_LIMIT');url=new URL(location,url).href;
      }
      if(!response?.ok)throw new Error('IMAGE_UNAVAILABLE');
      const declared=response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
      // GitHub Release assets are often served as octet-stream. Validate their
      // actual file signature rather than trusting an extension or that header.
      if(!['image/png','image/jpeg','image/gif','image/webp','application/octet-stream'].includes(declared)) {await response.body?.cancel();throw new Error('INVALID_IMAGE_TYPE')}
      const bytes=await readEmailImage(response,signal),type=emailImageType(bytes);
      if(!type || declared!=='application/octet-stream' && type!==declared || total+bytes.length>EMAIL_TOTAL_IMAGE_BYTES)continue;
      const id=`mf-image-${attachments.length+1}@musefilm.top`;
      attachments.push({id,type,bytes});total+=bytes.length;
      html=html.replaceAll(`src="${escapeHtml(image.url)}"`,`src="cid:${id}"`);
    }catch{/* Keep the original HTTPS image when download/size/type checks fail. */}
  }
  return {...message,html,inlineImages:attachments};
}

function emailBytesBase64(bytes) {
  let binary='';for(let start=0;start<bytes.length;start+=32768)binary+=String.fromCharCode(...bytes.subarray(start,start+32768));
  return btoa(binary).match(/.{1,76}/g)?.join('\r\n') || '';
}
