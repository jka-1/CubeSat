const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function check(condition,message){if(!condition)throw Error(message)}
async function until(test){const end=performance.now()+6000;while(!test()){if(performance.now()>end)throw Error('Animation did not settle');await sleep(100)}}
export async function run({viewer,output,status}){
 const report={name:'visual',checks:[],comparisons:[]},captures=new Map(),gallery=document.querySelector('#gallery');gallery.replaceChildren();
 const log=(name,data={})=>{report.checks.push({name,pass:true,...data});output.textContent=JSON.stringify(report,null,2)};
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 async function capture(api,variant,name){
  const data=api.capture(),image=new Image();image.src=data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  const fig=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=variant+' · '+name;fig.append(caption,image);gallery.append(fig);
  await fetch('/__image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:variant+'-'+name,data})});
  if(variant==='baseline')captures.set(name,{pixels,camera:structuredClone(api.state().camera)});else{
   const before=captures.get(name);let changed=0,sum=0,max=0;for(let i=0;i<pixels.length;i+=4){let d=0;for(let c=0;c<3;c++){const x=Math.abs(pixels[i+c]-before.pixels[i+c]);sum+=x;d=Math.max(d,x)}if(d>8)changed++;max=Math.max(max,d)}
   report.comparisons.push({name,changedPixelsOver8:changed/(pixels.length/4),meanChannelDifference:sum/(pixels.length/4*3),maxChannelDifference:max,cameraBefore:before.camera,cameraAfter:structuredClone(api.state().camera)});
  }
 }
 for(const variant of ['baseline','optimized']){
  status.textContent='Visual checks '+variant;
  await new Promise(resolve=>{viewer.onload=resolve;viewer.src='/site/knight-eps-phase12/viewer/?variant='+variant});
  const win=viewer.contentWindow;while(!win.knightEPSTwin)await sleep(50);const api=win.knightEPSTwin,doc=viewer.contentDocument;await api.ready;api.setQuality('studio');await sleep(1800);
  const state=api.state();check(state.parts.length===95,'Lost component identities');check(state.camera.pixelRatio===2,'Changed Studio output DPR');
  await capture(api,variant,'assembled');
  doc.querySelector('#top-toggle').click();await until(()=>api.state().coverProgress===1);await sleep(600);check(api.state().coverProgress===1,'Lid failed');api.view('top');await sleep(600);await capture(api,variant,'lid-top');
  doc.querySelector('#explode-toggle').click();await until(()=>api.state().coverLiftProgress===1);await sleep(600);check(api.state().coverLiftProgress===1,'Lift failed');api.view('iso');await sleep(600);await capture(api,variant,'exploded');
  api.reset();await sleep(1800);
  const source=await fetch('/site/knight-eps-phase12/docs/model-upgrades.json').then(r=>r.json());
  for(const board of source.boards){const item=api.geometryAudit().find(p=>p.id===board.id);check(item.triangles===board.triangles&&item.sha256===board.sha256,'Geometry audit failed '+board.id)}
  log(variant+' seven-board geometry audit');
  for(const id of ['MCU_Final','NerdMiner_Board_LCD','Mount_Regulator_01_01_Clip','Mount_Regulator_01_01_Base']){
   api.select(id);doc.querySelector('#isolate-selected').click();api.focus();await sleep(650);const probe=api.selectionProbe();check(probe,'Pick probe failed '+id);
   const canvas=doc.querySelector('#canvas canvas'),r=canvas.getBoundingClientRect();for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new win.PointerEvent(type,{bubbles:true,clientX:r.left+probe.x,clientY:r.top+probe.y,pointerId:1,button:0,pointerType:'mouse'}));check(api.state().selected===id,'Wrong owner '+id);
   check(api.state().parts.filter(p=>p.visible).length===1,'Isolation failed '+id);
   if(id==='MCU_Final')await capture(api,variant,'pcb');if(id==='NerdMiner_Board_LCD')await capture(api,variant,'payload-body');if(id.endsWith('_Clip'))await capture(api,variant,'fixture');
   api.setVisible(id,false);check(!api.state().parts.find(p=>p.id===id).visible,'Visibility failed');api.setVisible(id,true);doc.querySelector('#isolate-selected').click();log(variant+' select/highlight/isolate/raycast/visibility '+id);
  }
  api.reset();await sleep(1800);api.view('miner');await sleep(650);await capture(api,variant,'payload-acrylic');
  const camera=api.state().camera;api.setQuality('performance');await sleep(200);check(api.state().camera.pixelRatio===1,'Performance mode lost');check(same(camera.position,api.state().camera.position)&&same(camera.target,api.state().camera.target),'Quality moved camera');api.setQuality('studio');
  doc.querySelector('#xray-toggle').click();await sleep(200);check(api.state().xray,'Xray lost');doc.querySelector('#xray-toggle').click();
  api.updateTelemetry({battery_voltage_v:15.42,temperature_c:26.5,light_level:73},{source:'live'});await sleep(150);check(api.state().display.readings.battery_voltage_v===15.42,'Telemetry lost');
  if(variant==='optimized'){
   let before=api.performance().renderCount;await sleep(1200);check(api.performance().renderCount>before,'LCD age did not invalidate');
   Object.defineProperty(doc,'hidden',{value:true,configurable:true});doc.dispatchEvent(new win.Event('visibilitychange'));before=api.performance().renderCount;api.updateTelemetry({battery_voltage_v:15.6},{source:'live'});await sleep(1200);check(api.performance().renderCount===before,'Hidden document rendered');delete doc.hidden;doc.dispatchEvent(new win.Event('visibilitychange'));await sleep(150);check(api.performance().renderCount>before,'Visible document failed to resume');log('hidden/resume and LCD age invalidation');const clock=win.Date.now;const current=clock();win.Date.now=()=>current+16000;api.setTelemetryTransport('connected');check(api.state().display.health==='stale','Staleness clock lost');win.Date.now=clock;
  }
  api.setScreenState('standby',{title:'DISPLAY CHECK',message:'READY'});await sleep(100);check(api.state().display.presentation.title==='DISPLAY CHECK','Presentation display lost');api.resetTelemetry();api.setScreenState('telemetry');
  api.reset();await sleep(1800);
  for(const kind of ['top','bottom','front','rear','side','iso']){api.view(kind);await sleep(500);const b=api.projectedBounds();check(b.min.every(x=>x>-.999)&&b.max.every(x=>x<.999),'Clipped camera '+kind)}
  if(variant==='optimized'){
   const canvas=doc.querySelector('#canvas canvas'),r=canvas.getBoundingClientRect();let captured=false;canvas.setPointerCapture=()=>{captured=true};canvas.releasePointerCapture=()=>{};
   const event=(type,x,y)=>canvas.dispatchEvent(new win.PointerEvent(type,{bubbles:true,clientX:r.left+x,clientY:r.top+y,pointerId:7,button:0,pointerType:'mouse',buttons:type==='pointerup'?0:1}));
   event('pointerdown',300,300);event('pointermove',340,320);const before=api.performance().renderCount;event('pointerup',340,320);await sleep(700);check(captured&&api.performance().renderCount>before+2,'Camera damping did not continue');await sleep(3300);const settled=api.performance().renderCount;await sleep(400);check(api.performance().renderCount===settled,'Camera damping did not sleep');log('camera damping continues then sleeps');api.view('iso');await sleep(600);
  }
  const cameraBefore=api.state().camera;doc.querySelector('#sidebar-toggle').click();await sleep(200);const wider=api.state().camera;check(same(cameraBefore.position,wider.position)&&same(cameraBefore.target,wider.target),'Sidebar changed orbit anchor');doc.querySelector('#sidebar-toggle').click();await sleep(200);log(variant+' quality/xray/telemetry/display/camera/resize checks');
 }
 report.complete=true;parent.report(report);status.textContent='Visual checks complete';
}
