const app=document.querySelector('#app'),output=document.querySelector('#results'),status=document.querySelector('#status');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let results=[];
const log=(name,data)=>{results.push({name,...data});output.textContent=JSON.stringify(results,null,2)};
function check(condition,message){if(!condition)throw Error(message)}
async function until(test){const start=performance.now();while(!test()){if(performance.now()-start>15000)throw Error('Timed out waiting for viewer');await pause(60)}}
const context=()=>{const page=app.contentDocument,frame=page.querySelector('#knight-eps-twin');return {page,frame,win:frame?.contentWindow,doc:frame?.contentDocument,api:frame?.contentWindow?.knightEPSTwin}};
await until(()=>context().api);await context().api.ready;status.textContent='Viewer ready';
const camera=()=>{const c=context().api.state().camera;return {position:c.position,target:c.target,up:c.up}};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const settled=()=>pause(1500);
function layout(){const {page,frame,doc,api}=context(),root=page.querySelector('#page-root'),header=page.querySelector('.site-header'),canvas=doc.querySelector('#canvas canvas'),panel=doc.querySelector('.sidebar'),r=frame.getBoundingClientRect();return {appViewport:[app.clientWidth,app.clientHeight],siteViewport:[page.documentElement.clientWidth,page.documentElement.clientHeight],documentSize:[page.documentElement.scrollWidth,page.documentElement.scrollHeight],headerBottom:header.getBoundingClientRect().bottom,frame:{x:r.x,y:r.y,width:r.width,height:r.height},rootPadding:getComputedStyle(root).padding,frameBorder:getComputedStyle(frame).borderWidth,canvas:[canvas.clientWidth,canvas.clientHeight],sidebarOpen:doc.querySelector('#sidebar-toggle').getAttribute('aria-expanded'),sidebarWidth:panel.getBoundingClientRect().width,state:api.state().camera,projectedBounds:api.projectedBounds()}}
document.querySelector('#layout').onclick=()=>{output.hidden=false;log('Current viewport',layout())};
document.querySelector('#dismiss').onclick=()=>output.hidden=true;
document.querySelector('#run').onclick=async()=>{
 output.hidden=false;results=[];status.textContent='Running…';
 try{
  const {page,frame,win,doc,api}=context();await api.ready;
  const report=await fetch('/site/knight-eps-phase12/docs/model-upgrades.json').then(r=>r.json());
  const audit=api.geometryAudit();check(audit.length===7,'Expected seven replacement PCB assemblies');
  for(const board of report.boards){const a=audit.find(a=>a.id===board.id);check(a&&a.sha256===board.sha256&&a.triangles===board.triangles&&!a.hasObsoleteMesh,`Source geometry mismatch: ${board.id}`)}
  log('Seven detailed sources loaded',{pass:true,boards:audit});
  check(!/NerdMiner|\bMiner\b|Phase\s*\d|6U XL CubeSat electrical power system/i.test(doc.body.innerText),'Unwanted user-facing label');log('Labels',{pass:true});
  const l=layout();check(Math.abs(l.headerBottom-l.frame.y)<1&&Math.abs(l.frame.height+l.headerBottom-l.siteViewport[1])<1,'Frame does not fill available viewport');check(l.documentSize[0]===l.siteViewport[0]&&l.documentSize[1]===l.siteViewport[1],'Unexpected page scroll');log('Integrated viewport',{pass:true,...l});
  api.reset();await settled();let before=camera();doc.querySelector('#sidebar-toggle').click();await pause(150);check(same(before,camera()),'Sidebar moved camera or orbit pivot');doc.querySelector('#sidebar-toggle').click();await pause(150);check(same(before,camera()),'Sidebar restoration moved camera');log('Sidebar and stable orbit target',{pass:true});
  for(const board of report.boards){
   api.select(board.id);doc.querySelector('#isolate-selected').click();api.focus();await settled();const probe=api.selectionProbe();check(probe,`No raycasting point for ${board.id}`);const canvas=doc.querySelector('#canvas canvas'),rect=canvas.getBoundingClientRect();for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new win.PointerEvent(type,{bubbles:true,clientX:rect.left+probe.x,clientY:rect.top+probe.y,pointerId:1,button:0,pointerType:'mouse'}));check(api.state().selected===board.id,'Raycasting selected the wrong PCB');const visible=api.state().parts.filter(p=>p.visible);check(visible.length===1&&visible[0].id===board.id,'Isolation lost assembly ownership');doc.querySelector('#isolate-selected').click();api.setVisible(board.id,false);check(!api.state().parts.find(p=>p.id===board.id).visible,'Board visibility did not change');api.setVisible(board.id,true);log('Select, highlight, isolate, focus and raycast '+board.id,{pass:true,probe});
  }
  api.reset();await settled();doc.querySelector('#top-toggle').click();await settled();check(api.state().coverProgress>.999,'Lid failed to open');doc.querySelector('#top-toggle').click();await settled();check(api.state().coverProgress<.001,'Lid failed to close');
  doc.querySelector('#explode-toggle').click();await settled();check(api.state().exploded&&api.state().coverLiftProgress>.999,'Explosion did not settle');
  const ids=report.boards.map(b=>b.id);const exploded=api.state().parts.filter(p=>ids.includes(p.id));check(exploded.length===7,'A board vanished when exploded');
  for(const view of ['top','bottom','front','rear','side','iso']){api.view(view);await pause(500);const b=api.projectedBounds();check(b.min.every(x=>x>-.999)&&b.max.every(x=>x<.999),`Clipped exploded ${view} view`)}
  log('Lid, exploded PCB assemblies and six camera presets',{pass:true,exploded});api.reset();await settled();
  for(const view of ['top','bottom','front','rear','side','iso']){api.view(view);await pause(500);const b=api.projectedBounds();check(b.min.every(x=>x>-.999)&&b.max.every(x=>x<.999),`Clipped assembled ${view} view`)}
  before=camera();api.setQuality('studio');await pause(200);check(same(before,camera()),'Quality moved camera');check(api.state().camera.pixelRatio<=2,'Studio pixel ratio not capped');api.setQuality('performance');check(api.state().camera.pixelRatio<=1,'Performance pixel ratio not capped');log('Assembled presets and rendering quality',{pass:true,performance:api.performance()});
  const packet={battery_voltage_v:15.42,temperature_c:26.5,light_level:73};api.updateTelemetry(packet,{source:'live'});check(api.state().display.readings.battery_voltage_v===15.42&&api.state().display.display==='bound','Display telemetry binding lost');api.startMockTelemetry();check(api.state().display.source==='mock','Mock provenance lost');api.stopMockTelemetry();api.resetTelemetry();log('Telemetry/display API with explicit synthetic fixtures',{pass:true,note:'No hardware telemetry was connected.'});
  api.view('miner');await settled();check(api.state().selected==='NerdMiner_Board_LCD','Payload view reference broke');api.reset();await settled();
  const frames=[];let last=performance.now();for(let i=0;i<60;i++){await new Promise(r=>win.requestAnimationFrame(r));const now=performance.now();frames.push(now-last);last=now}frames.sort((a,b)=>a-b);log('Frame timing in this browser',{medianMs:frames[30],p95Ms:frames[57],performance:api.performance()});
  status.textContent='All checks passed';log('PASS',{pass:true});
 }catch(error){status.textContent='Check failed';log('FAIL',{error:error.message,stack:error.stack})}
};

document.querySelector('#gallery').onclick=async()=>{
 const {api,doc}=context(),gallery=document.querySelector('#gallery-view');gallery.replaceChildren();gallery.hidden=false;output.hidden=true;status.textContent='Capturing inspection views…';
 const report=await fetch('/site/knight-eps-phase12/docs/model-upgrades.json').then(r=>r.json());
 function capture(title){const fig=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=api.capture();img.alt=title;caption.textContent=title;fig.append(caption,img);gallery.append(fig)}
 for(const board of report.boards){api.reset();api.select(board.id);doc.querySelector('#isolate-selected').click();api.focus();await settled();capture(board.id+' · supplied detailed geometry')}
 api.reset();await settled();capture('Assembled · isometric');doc.querySelector('#top-toggle').click();await settled();api.view('top');await pause(500);capture('Lid open · top');doc.querySelector('#explode-toggle').click();await settled();api.view('iso');await pause(500);capture('Exploded · isometric');
 api.reset();await settled();status.textContent='Inspection views captured';
};
