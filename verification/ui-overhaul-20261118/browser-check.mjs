// Local-only UI regression run against tests/access/preview.mjs. No production or mail transport.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import dgram from 'node:dgram';
import {fileURLToPath} from 'node:url';
const out=process.env.KNIGHT_CAPTURE_DIR || path.dirname(fileURLToPath(import.meta.url));
const origin=process.env.KNIGHT_PREVIEW_ORIGIN || 'http://127.0.0.1:8096';
await mkdir(out,{recursive:true});
const profile=await mkdtemp(path.join(tmpdir(),'knight-overhaul-browser-'));
const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking','about:blank'],{stdio:['ignore','ignore','pipe']});
const results=[],errors=[],failures=[];let socket,session,id=0;const pending=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fixture=JSON.parse(await readFile(new URL('../../telemetry-bridge/test/fixtures/streaming-envelopes.json',import.meta.url)));
const udp=dgram.createSocket('udp4');let packetTimer=null;
try {
  let log='';const url=await new Promise((resolve,reject)=>{browser.stderr.on('data',chunk=>{log+=chunk;const match=log.match(/DevTools listening on (ws:\/\/\S+)/);if(match)resolve(match[1]);});browser.once('error',reject);browser.once('exit',()=>reject(Error(log)));});
  socket=new WebSocket(url);await once(socket,'open');
  socket.onmessage=({data})=>{const message=JSON.parse(data);if(message.id){const task=pending.get(message.id);if(!task)return;pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(JSON.stringify(message.error))):task.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);};
  const send=(method,params={},target=session)=>new Promise((resolve,reject)=>{const next=++id,timer=setTimeout(()=>{pending.delete(next);reject(Error('CDP timeout: '+method));},25000);pending.set(next,{resolve,reject,timer});socket.send(JSON.stringify({id:next,method,params,...(target?{sessionId:target}:{})}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  const wait=async(expression,limit=15000)=>{const start=Date.now();while(Date.now()-start<limit){if(await evaluate(expression))return;await sleep(75);}throw Error('Timed out: '+expression+'; '+errors.join('; '));};
  const check=async(name,expression)=>{const value=await evaluate(expression);results.push({name,pass:!!value});if(!value)failures.push(name);};
  const route=async(hash,marker)=>{await evaluate(`location.hash=${JSON.stringify(hash)}`);await wait(`!!document.querySelector(${JSON.stringify(marker)})`);await sleep(120);};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill=(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const viewport=async(width,height=900)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(180);};
  const capture=async(name,full=false)=>{
    await evaluate('document.fonts.ready');await sleep(220);
    if (full) await evaluate('scrollTo(0,0)');
    await evaluate(`Promise.all([...document.querySelectorAll('#resourceGallery img')].map(async img=>{img.loading='eager';await img.decode();}))`);
    const metrics=await send('Page.getLayoutMetrics');
    const clip=full?{x:0,y:0,width:metrics.cssContentSize.width,height:Math.min(metrics.cssContentSize.height,15000),scale:1}:undefined;
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:full,...(clip?{clip}:{})});
    await writeFile(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));
    console.log('Captured '+name);
  };
  const overflow=()=>evaluate('document.documentElement.scrollWidth <= innerWidth + 1');
  const targets=await send('Target.getTargets');session=(await send('Target.attachToTarget',{targetId:targets.targetInfos.find(t=>t.type==='page').targetId,flatten:true})).sessionId;
  await send('Runtime.enable');await send('Page.enable');await viewport(1440);
  await send('Page.navigate',{url:origin+'/#home'});await wait('!!document.querySelector(".ke-stage")');await sleep(500);
  await capture('home-desktop');await check('public hero has no horizontal overflow','document.documentElement.scrollWidth<=innerWidth+1');
  await evaluate('scrollTo(0,document.querySelector(".ke-story").getBoundingClientRect().top+scrollY-document.querySelector(".site-header").offsetHeight+(document.querySelector(".ke-story").offsetHeight-document.querySelector(".ke-stage").offsetHeight)*.49)');
  await wait('document.querySelector(".ke-video").readyState>=2 && !document.querySelector(".ke-video").seeking',20000);await sleep(500);await capture('home-deployed-desktop');
  await check('hero uses supplied film with decoded frames','!document.querySelector(".ke-film").hidden && Number(document.querySelector(".ke-stage").dataset.frame)>0');
  await click('[data-hero-jump]');
  await wait('Number(document.querySelector(".ke-stage").dataset.progress) >= .99');
  await sleep(600);await capture('home-workbench-desktop');
  await evaluate('scrollTo(0,document.querySelector(".ke-story").getBoundingClientRect().top+scrollY-document.querySelector(".site-header").offsetHeight+(document.querySelector(".ke-story").offsetHeight-document.querySelector(".ke-stage").offsetHeight)*.25)');
  await wait('Math.abs(Number(document.querySelector(".ke-stage").dataset.frame)-60)<3');
  await check('hero reverses to the correct film frame and has no manual stills switch','!document.querySelector(".ke-film").hidden && !document.querySelector(".ke-motion") && !document.querySelector(".ke-rule")');
  await viewport(390,844);await evaluate('scrollTo(0,0)');await sleep(300);await capture('home-mobile');await check('mobile hero fits width','document.documentElement.scrollWidth<=innerWidth+1');
  for(const page of ['team','resources','contact']){
    await viewport(1440);await route(page,page==='team'?'.profiles':page==='resources'?'#resourceGallery':'#contactForm');
    if(page==='resources'){
      await click('[data-scroll-target=projectSoftware]');
      await wait('document.querySelector("[data-scroll-target=projectSoftware]").getAttribute("aria-current") === "location"');
      await check('Resources navigation stays under the header and tracks the selection','Math.abs(document.querySelector(".resource-index").getBoundingClientRect().top-document.querySelector(".site-header").getBoundingClientRect().bottom) < 2');
      await wait('!!document.querySelector("#softwareArchitecture").contentDocument?.querySelector(".ke-node")');
      await evaluate('document.querySelector("#projectGallery").scrollIntoView()');await sleep(500);
    }
    await evaluate('scrollTo(0,0)');await capture(page+'-desktop',true);await check(page+' desktop fits width','document.documentElement.scrollWidth<=innerWidth+1');
    await viewport(390,844);await evaluate('scrollTo(0,0)');await capture(page+'-mobile',true);await check(page+' mobile fits width','document.documentElement.scrollWidth<=innerWidth+1');
    if(page==='resources'){
      await evaluate('document.querySelector("#projectSoftware").scrollIntoView()');await sleep(400);
      await evaluate('document.querySelector("#softwareArchitecture").contentDocument.querySelector(".ke-system").dispatchEvent(new MouseEvent("click",{bubbles:true}))');await sleep(900);
      await evaluate(`document.querySelector("#softwareArchitecture").contentDocument.querySelector('.ke-module[tabindex="0"]').dispatchEvent(new MouseEvent("click",{bubbles:true}))`);await sleep(900);
      await check('software details dock below the chart on mobile and iframe expands','document.querySelector("#softwareArchitecture").contentDocument.querySelector("#ke-panel").classList.contains("open") && document.querySelector("#softwareArchitecture").offsetHeight>=1200');
      await capture('software-mobile');
    }
    if(page==='contact'){
      await fill('#contactName','Test visitor');await fill('#contactEmail','invalid');await fill('#contactMessage','This test must not send mail.');
      await check('contact rejects invalid email before submission','!document.querySelector("#contactForm").checkValidity()');
      await fill('#contactEmail','visitor@example.org');await click('#contactSubmit');await wait('document.querySelector("#contactStatus").textContent.includes("not configured")');
      await check('contact reports an honest unconfigured state','!document.querySelector("#contactStatus").classList.contains("success")');
    }
  }
  await route('dashboard','#accountForm');await viewport(1440);await capture('login-desktop',true);await viewport(390,844);await capture('login-mobile',true);
  await check('sign-in is separate from dashboard navigation','document.querySelector("#dashboardNavigation").hidden && !document.querySelector("#accountPanel").hidden');
  await fill('#accountUsername','viewer');await fill('#accountPassword','local-test-only');await click('#accountSubmit');await wait('!!document.querySelector("#telemetryOverview [data-health]")');
  await click('[data-source-mode=mock]');await wait('document.querySelector("[data-health-label]").textContent.includes("Simulated")');await sleep(5200);
  await viewport(1440);await capture('telemetry-simple-desktop',true);await check('Simple shows the bus with mock data and no streaming card','document.querySelector(".i2c-workspace").checkVisibility() && document.querySelector("[data-advanced-view]").hidden && !document.querySelector("#i2cStreamCard") && document.querySelector("[data-health]").dataset.state==="mock"');
  await viewport(390,844);await capture('telemetry-simple-mobile',true);await check('telemetry simple mobile fits width','document.documentElement.scrollWidth<=innerWidth+1');
  await click('[data-telemetry-view=advanced]');await check('advanced mode exposes measurement charts and complete packet evidence','document.querySelectorAll("[data-reading-key]").length>=21 && !document.querySelector("[data-advanced-view]").hidden && !document.querySelector(".i2c-workspace").checkVisibility() && document.querySelector("[data-raw]").textContent.includes("local mock telemetry")');
  await check('Advanced renders five focused component charts','document.querySelectorAll("[data-instrument-chart]").length === 5 && document.querySelectorAll(\'[data-instrument="cells"] .instrument-series\').length===4');
  await check('kit readout has inline trends, cell meters and charger rails','document.querySelectorAll("[data-readout-trend]").length >=21 && document.querySelectorAll("[data-readout-cell]").length===4 && document.querySelectorAll("[data-rail-value]").length === 4');
  await click('[data-pause-view]');
  const frozenReadout = await evaluate('document.querySelector("[data-readout-packet]").textContent');
  await sleep(3000);
  await check('Pause holds the Advanced readout while the UTC clock remains present',`document.querySelector("[data-health]").dataset.state === "paused" && document.querySelector("[data-readout-packet]").textContent === ${JSON.stringify(frozenReadout)} && document.querySelector("[data-utc]").textContent.endsWith("UTC")`);
  await click('[data-select-metric="bms.cell0"]');
  await check('paused trend can inspect the selected frozen series','document.querySelector("[data-chart-current]").textContent.includes("Cell 1 voltage") && document.querySelector("[data-metric-select]").value === "bms.cell0"');
  await click('[data-pause-view]');
  await check('Resume catches up to buffered telemetry',`document.querySelector("[data-health]").dataset.state === "mock" && document.querySelector("[data-readout-packet]").textContent !== ${JSON.stringify(frozenReadout)}`);
  await check('sidebar account shows the signed-in identity and role','document.querySelector("[data-account-role]").textContent === "Viewer" && document.querySelector("[data-account-session]").textContent.includes("Signed in")');
  await click('.battery-inspect');
  await check('battery details open above the dashboard','document.querySelector("#i2cDetailLayer").matches(":modal") && document.querySelector("#i2cDetailTitle").checkVisibility()');
  await click('[data-close-detail]');
  await check('battery details close and restore focus','!document.querySelector("#i2cDetailLayer").open && document.activeElement.matches(".battery-inspect")');
  await viewport(1440);await capture('telemetry-advanced-desktop',true);await viewport(390,844);await capture('telemetry-advanced-mobile',true);await check('telemetry advanced mobile fits width','document.documentElement.scrollWidth<=innerWidth+1');
  await viewport(1440);
  await check('desktop sidebar houses the product identity and active route','document.querySelector("#sidebarTop .orbital-mark").checkVisibility() && document.querySelector("#dashboardTabs [aria-current=page]").dataset.route === "communication"');
  const darkLogo = await evaluate('getComputedStyle(document.querySelector(".orbital-mark")).color');
  await click('#sidebarToggle');await check('sidebar collapses with accessible icon links','document.body.dataset.sidebar === "compact" && document.querySelector("#dashboardTabs a svg") && document.querySelector("#sidebarToggle").getAttribute("aria-expanded") === "false"');
  await click('#sidebarToggle');
  const changeTheme = async () => {
    await click('#accountButton'); await wait('document.querySelector("#accountMenu").matches(":popover-open")');
    await click('#menuTheme'); await wait('!document.querySelector("#accountMenu").matches(":popover-open")');
  };
  await click('#accountButton'); await wait('document.querySelector("#accountMenu").matches(":popover-open")');
  await capture('account-menu-desktop');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait('!document.querySelector("#accountMenu").matches(":popover-open")');
  await evaluate('window.originalTrend = document.querySelector("[data-main-chart]")');
  await changeTheme();
  await check('light mode preserves the mounted instrument and route','document.body.dataset.dashboardTheme === "light" && localStorage.getItem("knight.dashboardTheme") === "light" && location.hash === "#communication" && window.originalTrend === document.querySelector("[data-main-chart]")');
  await check('dashboard logo switches foreground with appearance',`getComputedStyle(document.querySelector(".orbital-mark")).color !== ${JSON.stringify(darkLogo)}`);
  await capture('telemetry-light-desktop',true);
  await viewport(390,844); await changeTheme();
  await check('mobile account can switch back to dark','document.body.dataset.dashboardTheme === "dark" && location.hash === "#communication"');
  await viewport(1440);
  await click('[data-source-mode=live]');await check('returning to live removes simulated snapshot values','document.querySelectorAll("[data-reading-key]")[0].textContent==="Unavailable"');
  await route('sequences','#accessDeniedTitle');await check('viewer cannot open branch definitions','document.querySelector("#seqName")===null && document.querySelector("#accessDeniedTitle").textContent.includes("Operator")');
  await click('#operatorSignIn');await wait('!document.querySelector("#accountPanel").hidden');await fill('#accountUsername','operator');await fill('#accountPassword','local-test-only');await click('#accountSubmit');await wait('!!document.querySelector("#seqName")');
  await fill('#seqName','UI overhaul regression fixture');await click('[data-add="if"]');
  for (const path of ['first','last']) {
    await click('.seq-branch:'+path+'-child .seq-insert');await click('[data-add="delay"]');
  }
  await click('#seqSave');await wait('document.querySelector("#seqState").textContent.includes("Saved revision")');
  await click('#seqNew');await click('#seqSavedTrigger');await click('[data-order-select]');await click('#seqLoad');
  await wait('document.querySelector("#seqState").textContent.includes("Loaded revision")');
  await check('saved conditional reloads with both paths','document.querySelectorAll(".seq-branch .seq-block").length===2');
  for (const [volts,branch] of [[12,'TRUE'],[0,'FALSE']]) {
    await fill('#seqSimulationTelemetry',JSON.stringify({telemetry:{pv:{busVoltageV:volts}}}));
    await click('#seqSimulate');
    await wait(`document.querySelector("#seqRunState").textContent.includes("completed") && document.querySelector("#seqEvents").textContent.includes("${branch}")`);
    await check('simulation follows '+branch+' path','document.querySelector("#seqProgress").value===100');
  }
  await fill('#seqName','Unsaved draft');await click('#accountButton');await click('#menuLogout');
  await wait('!!document.querySelector(".app-confirm[open]")');await click('.app-confirm [value=cancel]');
  await check('cancel sign-out keeps the operator draft','location.hash==="#sequences" && document.querySelector("#seqName").value==="Unsaved draft"');
  await fill('#seqName','UI overhaul regression fixture');
  await check('branch definition persists through the unchanged backend API',`fetch('/telemetry/sequences').then(r=>r.json()).then(d=>d.sequences.some(s=>s.name==='UI overhaul regression fixture'))`);
  await click('#seqDelete');await wait('document.querySelector(".app-confirm[open]")');
  await capture('sequence-delete-dialog');
  await check('saved definition delete opens native dialog focused on Cancel','document.querySelector(".app-confirm").matches(":modal") && document.activeElement.value === "cancel"');
  await click('.app-confirm [value=cancel]');await wait('!document.querySelector(".app-confirm")');
  await check('cancel keeps the saved definition',`fetch('/telemetry/sequences').then(r=>r.json()).then(d=>d.sequences.some(s=>s.name==='UI overhaul regression fixture'))`);
  await viewport(1440);await capture('sequences-desktop',true);await viewport(390,844);await capture('sequences-mobile',true);await check('branch editor mobile fits width','document.documentElement.scrollWidth<=innerWidth+1');
  let seq=100;
  const packet=()=>{const words='4353000403B30A280A0000280FA3000A00320EE50EDF0E5C0E5D00610000A507000309C4060E1388'.match(/.{4}/g).map(v=>parseInt(v,16));words[1]=6;words[2]=seq;words[13]=0x40;words.push(0xffce,Math.floor(seq*1000/65536),(seq*1000)&0xffff,0,0,0,2,0x0707,1000,5000,0,0,0,0,84,100);words.push(0x3ff,1508,2981,100,5000,5000,14940,14950,35,0x80,736,0x0201);seq++;udp.send(Buffer.from(words.map(v=>v.toString(16).padStart(4,'0')).join('')),Number(process.env.KNIGHT_UDP_PORT || 33396),'127.0.0.1');};
  packet();packetTimer=setInterval(packet,600);
  await viewport(1440);await route('communication','#telemetryOverview');
  await wait(`document.querySelector('[data-health]').dataset.state === 'live' && document.querySelector('[data-rail-value="mppt.vbusV"]').textContent.endsWith(' V')`);
  await check('UDP packet values reach the I²C readout through SSE',`(() => {
    const packet = JSON.parse(document.querySelector('[data-raw]').textContent).packet;
    return document.querySelector('[data-reading-key="bms.packV"]').textContent === packet.telemetry.bms.packVoltageV.toFixed(3)+' V' &&
      document.querySelector('[data-rail-value="mppt.vbusV"]').textContent === packet.telemetry.mppt.vbusV.toFixed(3)+' V';
  })()`);
  await capture('telemetry-live-desktop',true);
  await route('runs','#runStart');await wait('!document.querySelector("#runStart").disabled');await fill('#runName','Local UI regression run');await click('#runStart');await wait('!document.querySelector("#runStop").disabled').catch(async error=>{throw Error(error.message+' '+await evaluate('document.querySelector("#captureMessage").textContent'));});await sleep(1300);await click('#runStop');await wait('document.querySelectorAll("#runList .run-list-item").length>0');await click('#runList .run-list-item');await wait('!document.querySelector("#runDetailContent").hidden');
  await viewport(1440);await capture('runs-desktop',true);await viewport(390,844);await capture('runs-mobile',true);await check('saved runs remain searchable above the selected run','document.querySelector("#runSearch").getBoundingClientRect().top<document.querySelector("#runList").getBoundingClientRect().top && document.querySelector("#runList").getBoundingClientRect().top<document.querySelector("#runDetail").getBoundingClientRect().top');
  await check('recorded run has selectable metrics and CSV controls','document.querySelector("#seriesMetric").options.length>0 && [...document.querySelectorAll("button")].some(b=>b.textContent.includes("CSV"))');
  for(const [hash,marker] of [['link-health','#link-health'],['debug-mode','#dmRegister'],['manual','.manual-frame'],['twin','#knight-eps-twin']]){
    await viewport(1440);await route(hash,marker);
    if(hash==='twin'){
      await wait('document.querySelector("#knight-eps-twin").contentDocument?.querySelector("#top-toggle")?.disabled===false',60000);
      const probe = await evaluate(`(()=>{const f=document.querySelector('#knight-eps-twin'), api=f.contentWindow.knightEPSTwin;
        for(const b of f.contentDocument.querySelectorAll('#parts button[data-name]')){
          api.select(b.dataset.name);const p=api.selectionProbe();if(p){const r=f.getBoundingClientRect(),c=f.contentDocument.querySelector('.viewport canvas').getBoundingClientRect();return {x:Math.round(r.left+c.left+p.x),y:Math.round(r.top+c.top+p.y)}}
        }return null})()`);
      if (!probe) throw Error('Could not find visible twin component');
      for(const clickCount of [1,2]){
        await send('Input.dispatchMouseEvent',{type:'mousePressed',...probe,button:'left',clickCount});
        await send('Input.dispatchMouseEvent',{type:'mouseReleased',...probe,button:'left',clickCount});
      }
      await wait('document.querySelector("#knight-eps-twin").contentWindow.knightEPSTwin.state().orbitMode==="focus"');
      await sleep(550);
      const state = 'document.querySelector("#knight-eps-twin").contentWindow.knightEPSTwin.state()';
      const before = await evaluate(state+'.camera');
      await send('Input.dispatchMouseEvent',{type:'mousePressed',...probe,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:probe.x+65,y:probe.y+24,button:'left',buttons:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:probe.x+65,y:probe.y+24,button:'left',clickCount:1});
      await sleep(430);
      await check('drag orbits the focused component after a double click',`(()=>{const after=${state}.camera;const before=${JSON.stringify(before)};return Math.hypot(...after.position.map((v,i)=>v-before.position[i]))>.005 && Math.hypot(...after.target.map((v,i)=>v-before.target[i]))<.001})()`);
      await evaluate(`(()=>{const f=document.querySelector('#knight-eps-twin');const b=f.contentDocument.querySelector('#parts button[data-name="BMS_BQ76942"]');b.click();b.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
      await sleep(600);
      const floorProbe=await evaluate(`(()=>{const f=document.querySelector('#knight-eps-twin'), r=f.getBoundingClientRect(), c=f.contentDocument.querySelector('.viewport canvas').getBoundingClientRect();return {x:Math.round(r.left+c.left+c.width*.25),y:Math.round(r.top+c.top+c.height*.5),dx:Math.round(c.height*.47)}})()`);
      const {x,y,dx}=floorProbe;
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+dx,y,button:'left',buttons:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+dx,y,button:'left',clickCount:1});
      await sleep(950);
      await check('floor PCB can be orbited from beneath without losing the target',`(()=>{const v=${state};return v.selected==='BMS_BQ76942' && v.orbitMode==='focus' && v.camera.position[1]<v.camera.target[1] && v.focusReveal.some(id=>id.startsWith('Chassis'));})()`);
      await capture('twin-floor-focus');
    }
    await capture(hash+'-desktop',hash!=='twin');await viewport(390,844);await capture(hash+'-mobile',hash!=='twin');await check(hash+' mobile fits width','document.documentElement.scrollWidth<=innerWidth+1');
  }
  for(const width of [1024,768]){
    await viewport(width,900);await route('communication','#telemetryOverview');await check(`telemetry fits ${width}px`,'document.documentElement.scrollWidth<=innerWidth+1');await capture(`telemetry-${width}`,true);
    await route('resources','#projectSoftware');await check(`resources fit ${width}px`,'document.documentElement.scrollWidth<=innerWidth+1');await capture(`resources-${width}`,true);
  }
  for (const [name,title] of [['privacy','Privacy'],['accessibility','Accessibility'],['credits','Credits & Licenses']]) {
    await route(name,'.informational-page');await check(name+' page loads through the public router',`document.querySelector('.informational-page h1').textContent === ${JSON.stringify(title)}`);
    if (name === 'privacy') {
      for (const width of [1440,768,390]) {await viewport(width,900);await capture('privacy-'+width,true);await evaluate('document.querySelector("#publicFooter").scrollIntoView({block:"end"})');await capture('footer-'+width);await check('Privacy fits at '+width,'document.documentElement.scrollWidth<=innerWidth+1');}
    }
  }
  await route('home','.ke-stage');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait('document.querySelector(".ke-story").classList.contains("ke-stills")');await check('reduced motion uses still images without a scroll trap','document.querySelector(".ke-story").classList.contains("ke-stills") && document.querySelector(".ke-video").hidden');
  await click('#accountButton');await wait('document.querySelector("#accountMenu").matches(":popover-open")');
  await click('#menuLogout');await wait('document.body.dataset.signedIn==="false"');
  await check('sign-out releases the session from the public account menu','fetch("/telemetry/auth/me").then(async response => response.status===401 || !(await response.json()).user)');
  results.push({name:'no browser exceptions',pass:errors.length===0});if(errors.length)failures.push(...errors);
  await writeFile(path.join(out,'browser-results.json'),JSON.stringify({results,errors,failures},null,2));
  console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failures},null,2));
  if(failures.length)process.exitCode=1;
} catch(error){await writeFile(path.join(out,'browser-results.json'),JSON.stringify({results,errors,error:error.stack},null,2));console.error(error.stack);process.exitCode=1;}
finally{clearInterval(packetTimer);try{udp.close();}catch{}socket?.close();for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('closed'));}if(browser.exitCode===null){browser.kill();await once(browser,'exit');}await rm(profile,{recursive:true,force:true});}
