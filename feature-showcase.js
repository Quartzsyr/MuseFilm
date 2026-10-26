// Compact, deliberate feature selection. Scrolling never changes the selected tab.
export function mountFeatureShowcase({reducedMotion=false,translate}) {
 const root=document.querySelector('[data-feature-cinema]');if(!root)return {refresh(){}};
 const panels=[...root.querySelectorAll('[data-showcase-panel]')],tabs=[...root.querySelectorAll('[data-showcase-tab]')],orbit=root.querySelector('[data-watermark-orbit]'),frames=[...orbit.children],video=root.querySelector('[data-desktop-video]');
 const enclosingDetails=root.closest?.('details');
 const media=matchMedia('(prefers-reduced-motion: reduce)');let reduce=reducedMotion||media.matches,active=0,near=false,raf=0,page=0,watermarkTurn=0,wantVideo=!reduce,explicitVideo=false,desktopMode=0;
 const labels=['classic','center','split','corner','rail','swiss'],modeTimes=[0,4.2,8.2];root.dataset.motionReady='true';
 function loadPanel(index){panels[index].querySelectorAll('img[data-showcase-src]').forEach(img=>{if(!img.getAttribute('src'))img.src=img.dataset.showcaseSrc})}
 function videoAllowed(){return !!video&&near&&active===2&&(!enclosingDetails||enclosingDetails.open)&&!document.hidden&&wantVideo&&(!reduce||explicitVideo)}
 function videoLabel(){if(!video)return;const paused=video.paused;root.querySelector('[data-desktop-play-label]').textContent=translate(paused?'showcase.desktop.play':'showcase.desktop.pause');root.querySelector('[data-desktop-play]').setAttribute('aria-pressed',String(!paused))}
 function syncVideo(){
  if(!video)return;
  if(!videoAllowed()){video.pause();videoLabel();return}
  if(!video.getAttribute('src')){video.src=video.dataset.showcaseVideo;video.load()}
  if(video.paused){const playing=video.play();playing?.then(()=>{if(!videoAllowed())video.pause();videoLabel()}).catch(()=>videoLabel())}
 }
 function paint(){
  raf=0;if(!near||document.hidden||(enclosingDetails&&!enclosingDetails.open))return;
  root.style.setProperty('--spread-mix',String(page));
  orbit.style.transition=reduce?'none':'transform 650ms cubic-bezier(.22,1,.36,1)';orbit.style.transform=`rotateY(${-watermarkTurn*60}deg)`;
  frames.forEach((frame,i)=>{const angle=((i*60-watermarkTurn*60+540)%360+360)%360-180;frame.style.setProperty('--wm-dim',String(Math.min(.75,Math.abs(angle)/170)));frame.setAttribute('aria-hidden',String(Math.abs(angle)>30))});
  root.querySelector('[data-watermark-name]').textContent=translate('showcase.style.'+labels[(watermarkTurn%6+6)%6]);
  root.querySelector('[data-showcase-progress]').style.transform=`scaleX(${(active+1)/panels.length})`;videoLabel();
 }
 function queue(){if(!raf&&near&&!document.hidden)raf=requestAnimationFrame(paint)}
 function select(index){
  active=Math.max(0,Math.min(panels.length-1,index));root.dataset.scene=String(active);loadPanel(active);
  panels.forEach((panel,i)=>{panel.classList.toggle('is-active',i===active);panel.inert=i!==active;panel.setAttribute('aria-hidden',String(i!==active))});
  tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===active));tab.tabIndex=i===active?0:-1});
  root.querySelector('[data-showcase-count]').textContent=String(active+1).padStart(2,'0')+' / '+String(panels.length).padStart(2,'0');syncVideo();queue();
 }
 tabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>select(index));
  tab.addEventListener('keydown',event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();select(next);tabs[next].focus()});
 });
 root.querySelector('[data-book-turn]').addEventListener('click',()=>{page=1-page;queue()});
 root.querySelector('[data-watermark-prev]').addEventListener('click',()=>{watermarkTurn--;queue()});root.querySelector('[data-watermark-next]').addEventListener('click',()=>{watermarkTurn++;queue()});
 if(video){
  video.muted=true;video.addEventListener('playing',videoLabel);video.addEventListener('pause',videoLabel);
  video.addEventListener('loadedmetadata',()=>{try{video.currentTime=modeTimes[desktopMode]}catch{}});
  root.querySelector('[data-desktop-play]').addEventListener('click',()=>{explicitVideo=true;wantVideo=video.paused;syncVideo()});
  root.querySelectorAll('[data-desktop-mode]').forEach((button,index)=>button.addEventListener('click',()=>{desktopMode=index;explicitVideo=true;wantVideo=true;root.querySelectorAll('[data-desktop-mode]').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));try{video.currentTime=modeTimes[index]}catch{}syncVideo()}));
 }
 const observer=new IntersectionObserver(entries=>{near=entries[0].isIntersecting;if(near){loadPanel(active);queue()}else if(raf){cancelAnimationFrame(raf);raf=0}syncVideo()},{threshold:.1});observer.observe(root);
 document.addEventListener('visibilitychange',()=>{syncVideo();queue()});
 media.addEventListener('change',()=>{reduce=media.matches;explicitVideo=false;syncVideo();queue()});
 select(0);return {refresh(){syncVideo();queue();videoLabel()}};
}

// The supplied film is the compact default. Interactive assets initialize only
// after a deliberate expansion; either video pauses when its view is hidden.
export function mountFeaturePresentation({reducedMotion=false,translate}) {
 const wrapper=document.querySelector('[data-feature-presentation]');if(!wrapper)return {refresh(){}};
 const details=wrapper.querySelector('[data-feature-details]')||wrapper.querySelector('.feature-details'),promo=wrapper.querySelector('[data-product-promo]');
 let showcase=null,visible=false;
 const stopDetailsVideos=()=>details.querySelectorAll('video').forEach(video=>video.pause());
 function update(){
  wrapper.dataset.expanded=String(details.open);
  if(details.open){promo.pause();showcase??=mountFeatureShowcase({reducedMotion,translate});showcase.refresh()}
  else stopDetailsVideos();
 }
 details.addEventListener('toggle',update);
 const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible)promo.pause()},{threshold:.08});observer.observe(wrapper);
 promo.addEventListener('play',()=>{if(details.open||!visible||document.hidden)promo.pause()});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)promo.pause()});
 update();return {refresh(){showcase?.refresh()}};
}
