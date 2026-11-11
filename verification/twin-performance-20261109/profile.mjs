// Test-only instrumentation served by profile_server.py. No production import.
export function installProfile({THREE,renderer,scene,camera,controls,api,getParts}){
 const gl=renderer.getContext(),timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');
 const output=document.createElement('pre');output.id='profile-results';
 Object.assign(output.style,{position:'fixed',inset:'60px 10px 10px',overflow:'auto',background:'#fff',color:'#000',zIndex:100,fontSize:'12px',pointerEvents:'none'});
 document.body.append(output);
 const report={depth:new URL(location.href).searchParams.get('depth')||'logarithmic',userAgent:navigator.userAgent,dpr:devicePixelRatio,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),timerSupported:!!timer,results:[]};
 let active=null,query=null,pending=[],renderStart=0;
 const profile={skipAssemblyUpdates:false,beforeRender(now,updateMs){
  renderer.info.reset();renderStart=performance.now();
  if(!active)return;
  active.frames++;if(active.frames<=45)return;
  active.update.push(updateMs);if(active.previous!==null)active.intervals.push(now-active.previous);active.previous=now;
  if(timer&&active.frames%4===0){query=gl.createQuery();gl.beginQuery(timer.TIME_ELAPSED_EXT,query)}
 },afterRender(totalMs){
  if(query){gl.endQuery(timer.TIME_ELAPSED_EXT);pending.push({query,owner:active});query=null}
  for(let i=pending.length-1;i>=0;i--){const item=pending[i];if(gl.getQueryParameter(item.query,gl.QUERY_RESULT_AVAILABLE)){if(!gl.getParameter(timer.GPU_DISJOINT_EXT))item.owner.gpu.push(gl.getQueryParameter(item.query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(item.query);pending.splice(i,1)}}
  if(!active||active.frames<=45)return;
  active.cpu.push(totalMs);active.render.push(performance.now()-renderStart);active.calls.push(renderer.info.render.calls);active.triangles.push(renderer.info.render.triangles);
  if(active.frames>=165){const done=active;active=null;done.resolve(done)}
 }};
 renderer.info.autoReset=false;
 const stat=xs=>{const a=[...xs].sort((a,b)=>a-b);return {median:a.length?a[Math.floor(a.length*.5)]:null,p95:a.length?a[Math.min(a.length-1,Math.floor(a.length*.95))]:null,samples:a.length}};
 const measure=label=>new Promise(resolve=>{active={label,resolve,frames:0,previous:null,intervals:[],update:[],cpu:[],render:[],gpu:[],calls:[],triangles:[]};output.textContent=`Measuring ${label}…\n`+JSON.stringify(report,null,2)});
 async function run(){
  await api.ready;
  let meshCount=0;const materials=new Set(),geometries=new Set();
  scene.traverse(m=>{if(m.isMesh){meshCount++;materials.add(m.material);geometries.add(m.geometry)}});
  report.scene={meshCount,materials:materials.size,geometries:geometries.size,parts:getParts().length};
  const position=camera.position.clone(),target=controls.target.clone();
  const cases=[
   {label:'performance idle',quality:'performance',orbit:false},
   {label:'performance orbit',quality:'performance'},
   {label:'studio orbit native DPR',quality:'studio'},
   {label:'studio orbit DPR 1',quality:'studio',dpr:1},
   {label:'studio orbit DPR 1 cached shadows',quality:'studio',dpr:1,cache:true},
   {label:'studio orbit DPR 1 cached shadows half transmission',quality:'studio',dpr:1,cache:true,transmissionScale:.5},
   {label:'studio orbit DPR 1 no shadows',quality:'studio',dpr:1,shadows:false},
   {label:'studio orbit DPR 1 no transmission',quality:'studio',dpr:1,noTransmission:true},
   {label:'performance orbit skip assembly updates',quality:'performance',skip:true},
   {label:'performance orbit repeat',quality:'performance'},
  ];
  const suite=new URL(location.href).searchParams.get('suite');
  for(const test of cases.filter(test=>suite!=='depth'||['performance orbit','studio orbit DPR 1 cached shadows half transmission','performance orbit repeat'].includes(test.label))){
   api.setQuality(test.quality);renderer.shadowMap.autoUpdate=!test.cache;renderer.shadowMap.needsUpdate=true;
   if(test.shadows===false)renderer.shadowMap.enabled=false;
   renderer.transmissionResolutionScale=test.transmissionScale||1;
   if(test.dpr)renderer.setPixelRatio(test.dpr);
   if(test.noTransmission)scene.traverse(m=>{if(m.isMesh&&m.material.transmission>0){m.material.transmission=0;m.material.needsUpdate=true}});
   profile.skipAssemblyUpdates=!!test.skip;
   controls.autoRotate=false;controls.enableDamping=false;camera.position.copy(position);controls.target.copy(target);controls.update();controls.enableDamping=true;
   controls.autoRotate=test.orbit!==false;controls.autoRotateSpeed=2;
   const result=await measure(test.label);
   report.results.push({label:test.label,viewport:[renderer.domElement.clientWidth,renderer.domElement.clientHeight],buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],intervalMs:stat(result.intervals),cpuFrameMs:stat(result.cpu),cpuAssemblyMs:stat(result.update),cpuRenderMs:stat(result.render),gpuRenderMs:stat(result.gpu),drawCalls:stat(result.calls),triangles:stat(result.triangles)});
  }
  controls.autoRotate=false;api.setQuality('performance');profile.skipAssemblyUpdates=false;
  report.complete=true;output.textContent=JSON.stringify(report,null,2);document.title='Twin performance complete';
  const save=document.createElement('button');save.textContent='Save local measurements';save.id='save-profile';save.style.cssText='position:fixed;top:10px;left:10px;z-index:101';
  save.onclick=async()=>{const response=await fetch('/__profile_result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});save.textContent=response.ok?'Measurements saved':'Save failed'};document.body.append(save);
 }
 run().catch(error=>{report.error=String(error);output.textContent=JSON.stringify(report,null,2)});
 return profile;
}
