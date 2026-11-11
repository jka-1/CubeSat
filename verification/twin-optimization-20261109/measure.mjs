export function install({THREE,renderer,scene,camera,controls,api,parts,variant}){
 const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info'),timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 const stat=xs=>{const a=[...xs].sort((a,b)=>a-b);return {median:a[Math.floor(a.length*.5)]??null,p95:a[Math.min(a.length-1,Math.floor(a.length*.95))]??null,samples:a.length}};
 const report={name:variant,userAgent:navigator.userAgent,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),dpr:devicePixelRatio,results:[],timerSupported:!!timer};
 let frameStart=0,now=0,active=null,totalRenders=0,query=null;const pending=[];
 renderer.info.autoReset=false;
 const render=renderer.render.bind(renderer);
 renderer.render=(...args)=>{
  const measuring=active,shadowRefresh=renderer.shadowMap.enabled&&(renderer.shadowMap.autoUpdate||renderer.shadowMap.needsUpdate);renderer.info.reset();const start=performance.now();
  if(measuring&&timer&&measuring.frames%4===0){query=gl.createQuery();gl.beginQuery(timer.TIME_ELAPSED_EXT,query)}
  render(...args);totalRenders++;
  if(query){gl.endQuery(timer.TIME_ELAPSED_EXT);pending.push({query,owner:measuring});query=null}
  for(let i=pending.length-1;i>=0;i--){const item=pending[i];if(gl.getQueryParameter(item.query,gl.QUERY_RESULT_AVAILABLE)){if(!gl.getParameter(timer.GPU_DISJOINT_EXT))item.owner.gpu.push(gl.getQueryParameter(item.query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(item.query);pending.splice(i,1)}}
  if(!measuring)return;
  measuring.frames++;if(shadowRefresh)measuring.shadowFrames++;
  if(now>=measuring.start+measuring.warmup){if(measuring.previous!==null)measuring.intervals.push(now-measuring.previous);measuring.previous=now;measuring.cpu.push(performance.now()-frameStart);measuring.render.push(performance.now()-start);measuring.calls.push(renderer.info.render.calls);measuring.triangles.push(renderer.info.render.triangles);measuring.passes.push((renderer.shadowMap.enabled?2:1)+(shadowRefresh?1:0))}
 };
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 function pose(){controls.autoRotate=false;controls.enableDamping=false;camera.position.copy(position);controls.target.copy(target);camera.up.copy(up);camera.setViewOffset(...view);controls.update();controls.enableDamping=true}
 let position,target,up,view;
 async function measure(label,action,duration,warmup=0){
  const m={label,frames:0,previous:null,start:performance.now(),warmup,intervals:[],cpu:[],render:[],gpu:[],calls:[],triangles:[],passes:[],shadowFrames:0};active=m;action();await sleep(duration+warmup);active=null;
  report.results.push({label,viewport:[renderer.domElement.clientWidth,renderer.domElement.clientHeight],buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],outputDPR:renderer.getPixelRatio(),refractionScale:renderer.transmissionResolutionScale,intervalMs:stat(m.intervals),cpuFrameMs:stat(m.cpu),cpuRenderMs:stat(m.render),gpuMs:stat(m.gpu),drawCalls:stat(m.calls),triangles:stat(m.triangles),frames:m.frames,renderPasses:stat(m.passes),shadowFrames:m.shadowFrames,shadowRefreshCount:api.performance().shadowRefreshCount??null});
 }
 async function run(){
  await api.ready;api.setQuality('studio');await sleep(1500);
  position=camera.position.clone();target=controls.target.clone();up=camera.up.clone();const v=camera.view;view=[v.fullWidth,v.fullHeight,v.offsetX,v.offsetY,v.width,v.height];
  let meshCount=0;const materials=new Set();scene.traverse(m=>{if(m.isMesh){meshCount++;for(const mat of [m.material].flat())materials.add(mat)}});report.scene={meshCount,materials:materials.size,parts:parts.length};
  const loadedAudit=()=>{let triangles=0;for(const part of parts)part.traverse(m=>{if(m.isMesh)triangles+=(m.geometry.index?.count||m.geometry.attributes.position.count)/3});return triangles};report.sourceTriangles=loadedAudit();
  await measure('Studio full-resolution orbit',()=>{pose();controls.autoRotate=true;controls.autoRotateSpeed=2;controls.dispatchEvent({type:'change'})},3000,750);
  pose();await sleep(600);
  await measure('Studio full-resolution lid open',()=>document.querySelector('#top-toggle').click(),1800);
  document.querySelector('#top-toggle').click();await sleep(1800);pose();
  await measure('Studio full-resolution explosion',()=>document.querySelector('#explode-toggle').click(),1800);
  document.querySelector('#explode-toggle').click();await sleep(1800);pose();await sleep(750);
  const idleBefore=totalRenders;await sleep(2200);report.idle={durationMs:2200,renders:totalRenders-idleBefore};
  api.setQuality('performance');await sleep(500);pose();
  await measure('Performance orbit',()=>{controls.autoRotate=true;controls.autoRotateSpeed=2;controls.dispatchEvent({type:'change'})},2000,500);
  controls.autoRotate=false;controls.dispatchEvent({type:'change'});await sleep(500);api.setQuality('studio');pose();await sleep(500);
  report.metrics=api.performance();report.complete=true;parent.report(report);
 }
 if(!new URL(parent.location.href).searchParams.has('visual'))run().catch(e=>parent.report({...report,error:e.stack}));
 return {beginFrame(t){now=t;frameStart=performance.now()}};
}
