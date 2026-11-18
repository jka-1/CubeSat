// Supplied orbit-to-workbench film, with native scrolling and one decode in flight.
// Rendering never drives scroll position; a finished seek paints before the next seek.
export function initScrollHero() {
  const stage = document.querySelector('.ke-stage');
  if (!stage) return () => {};
  const story=stage.parentElement, video=stage.querySelector('video'), frame=stage.querySelector('.ke-frame');
  const title=stage.querySelector('.ke-title'), film=stage.querySelector('.ke-film');
  const context=film.getContext('2d',{alpha:false});
  const light=stage.querySelector('.ke-glint');
  const cue=stage.querySelector('.ke-scroll'), label=stage.querySelector('.ke-label');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'), controller=new AbortController();
  const opts={signal:controller.signal}, clamp=x=>Math.min(1,Math.max(0,x));
  const ramp=(a,b,p)=>{const t=clamp((p-a)/(b-a));return t*t*(3-2*t);};
  const feather=t=>{t=clamp(t);return t*t*t*t*(35+t*(-84+t*(70-20*t)));};
  const FPS=30,CUT=168,END=240;
  let mode='', top=0, travel=1, progress=-1, target=0, pending=-1, displayed=0;
  let velocity=0, raf=0,decodeFrame=0,disposed=false,failed=false,stillPath='',lastTick=0,lastMove=0,lastHeight=0,lastWidth=0,lastHeader=0;
  const siteHeader=document.querySelector('.site-header');
  const still=()=>reduced.matches||Boolean(navigator.connection?.saveData);
  const path=name=>`./assets/hero/media/${mode}/${name}`;
  function visible(el,a) {const hide=a<.001;if(el.hidden!==hide)el.hidden=hide;el.inert=a<.6;el.style.opacity=a.toFixed(3);}
  function benchCamera() {
    const t=still()||displayed<CUT?0:feather((progress-.74)/.26);
    const transform=t?`translate3d(${-1.2*t}%,${.5*t+.15*Math.sin(Math.PI*t)}%,0) scale(${1+.05*t})`:'none';
    film.style.transform=video.style.transform=frame.style.transform=transform;
  }
  function showImage(index) {
    const safe=index===0?0:index<CUT?124:CUT;
    if(!safe){frame.hidden=true;stillPath='';displayed=0;return;}
    const url=path(`${String(safe).padStart(3,'0')}.webp`);
    if(stillPath===url)return;
    stillPath=url;
    const image=new Image();image.src=url;
    image.decode().then(()=>{if(disposed||stillPath!==url)return;frame.src=url;frame.hidden=false;displayed=safe;benchCamera();}).catch(()=>{if(stillPath===url)stillPath='';});
  }
  function stopMovie(holdFrame = false) {
    if(decodeFrame)cancelAnimationFrame(decodeFrame);
    decodeFrame=0;pending=-1;video.pause();video.removeAttribute('src');video.load();video.hidden=true;if(!holdFrame)film.hidden=true;
  }
  function seek() {
    if(disposed||still()||failed||target===0||!video.getAttribute('src')||video.readyState<2||video.seeking||pending>=0)return;
    if(displayed===target&&(!film.hidden||!video.hidden))return;
    pending=target;
    // Mid-frame time avoids landing on a keyframe boundary with the prior pose.
    const requested=(pending+.35)/FPS;
    if(Math.abs(video.currentTime-requested)<.001){paintDecoded();return;}
    video.currentTime=requested;
  }
  function paintDecoded() {
    decodeFrame=0;
    if(disposed||still()||failed||pending<0)return;
    const decoded=pending;pending=-1;
    if(target>0){
      if(context && video.videoWidth){
        if(film.width!==video.videoWidth||film.height!==video.videoHeight){
          film.width=video.videoWidth;film.height=video.videoHeight;
        }
        context.drawImage(video,0,0);
        film.hidden=false;
      }else video.hidden=false;
      frame.hidden=true;stillPath='';displayed=decoded;stage.dataset.frame=String(decoded);benchCamera();
    }
    seek();
  }
  video.addEventListener('loadeddata',seek,opts);
  video.addEventListener('seeked',()=>{
    if(pending<0)return;
    // seeked has a decoded frame; committing on the next paint prevents a one-frame flash.
    if(decodeFrame)cancelAnimationFrame(decodeFrame);
    decodeFrame=requestAnimationFrame(paintDecoded);
  },opts);
  video.addEventListener('error',()=>{if(!video.getAttribute('src'))return;failed=true;pending=-1;video.hidden=true;film.hidden=true;showImage(target);},opts);
  function media() {
    if(still()||failed){video.hidden=true;film.hidden=true;showImage(target);return;}
    if(!video.getAttribute('src')){video.src=path('scroll.mp4');video.load();}
    if(!target){video.hidden=true;film.hidden=true;showImage(0);return;}
    seek();
  }
  function update(now) {
    raf=0;if(disposed)return;
    const desired=clamp((scrollY-top)/travel),dt=lastTick?Math.min(64,now-lastTick):16.7;
    lastTick=now;
    let p = desired;
    if (!still() && progress >= 0) {
      // Critically damped motion preserves momentum while approaching each new scroll target.
      const seconds = dt / 1000, rate = 15;
      const error = progress - desired;
      if (velocity * error > 0) velocity = 0;
      const direction = velocity + rate * error;
      const decay = Math.exp(-rate * seconds);
      p = desired + (error + direction * seconds) * decay;
      velocity = (velocity - rate * direction * seconds) * decay;
      if ((p - desired) * error <= 0 || Math.abs(p - desired) < .00008) {
        p = desired;
        velocity = 0;
      }
    } else velocity = 0;
    if(progress>=0&&Math.abs(p-progress)>.00005)lastMove=now;
    progress=p;
    // Preserve the original corrected bad frame and the approved bench-camera limit.
    let index=still()?(p<.24?0:p<.70?124:END):Math.min(END,Math.floor(p*END+.0001));
    target=Math.min(index===123?124:index,CUT);
    visible(title,still() ? Number(p < .62) : 1-ramp(.49,.64,p));
    cue.querySelector('span').textContent=still()?'Scroll to explore':p<.52?'Scroll to deploy':p<.74?'Scroll to the workbench':'Scroll to explore';
    label.textContent=p<.70?'Flight concept':'UCF prototype';
    stage.dataset.progress=p.toFixed(5);
    if(!still()&&p>.50&&p<.76&&light.dataset.mode!==mode){light.src=path('reflection.webp');light.dataset.mode=mode;light.hidden=false;}
    const glow=still()?0:ramp(.664,.699,p)*(1-ramp(.701,.738,p))*(1-ramp(55,470,now-lastMove));
    light.style.opacity=glow.toFixed(4);stage.style.setProperty('--solar-veil',(glow**3*.48).toFixed(4));
    media();benchCamera();
    if(!still()&&(p!==desired||glow>.0005))raf=requestAnimationFrame(update);else lastTick=0;
  }
  function schedule(){if(!raf&&!disposed)raf=requestAnimationFrame(update);}
  function measure() {
    const headerHeight=Math.ceil(siteHeader?.getBoundingClientRect().height||0);
    if(headerHeight&&headerHeight!==lastHeader){lastHeader=headerHeight;document.documentElement.style.setProperty('--site-header-height',`${headerHeight}px`);}
    const width=stage.clientWidth,height=stage.clientHeight;
    top=story.getBoundingClientRect().top+scrollY-headerHeight;travel=Math.max(1,story.offsetHeight-height);
    if(lastWidth===width&&lastHeight===height){schedule();return;}
    const ratio=width/height,next=ratio<=.7?'p':ratio<=1.3?'m':ratio>=2.05?'u':'d';
    if(next!==mode){stopMovie(Boolean(mode));mode=next;failed=false;stillPath='';displayed=-1;frame.hidden=true;light.hidden=true;light.removeAttribute('src');delete light.dataset.mode;}
    lastWidth=width;lastHeight=height;schedule();
  }
  function applyMode() {
    if(still())stopMovie();
    story.classList.toggle('ke-stills',still());
    progress=-1;measure();
  }
  reduced.addEventListener('change',applyMode,opts);
  document.querySelector('[data-hero-jump]')?.addEventListener('click',()=>{
    scrollTo({top:top+travel,behavior:still()?'instant':'smooth'});schedule();
  },opts);
  window.addEventListener('scroll',schedule,{passive:true,signal:controller.signal});
  window.addEventListener('resize',measure,{passive:true,signal:controller.signal});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){lastTick=0;schedule();}},opts);
  const observer=new ResizeObserver(measure);observer.observe(story);observer.observe(stage);if(siteHeader)observer.observe(siteHeader);
  applyMode();
  return()=>{disposed=true;controller.abort();observer.disconnect();cancelAnimationFrame(raf);cancelAnimationFrame(decodeFrame);stopMovie();document.documentElement.style.removeProperty('--site-header-height');};
}
