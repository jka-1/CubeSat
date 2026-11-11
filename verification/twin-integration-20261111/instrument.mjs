// Local CDP-injected measurement only. Never imported by the shipped viewer.
export function instrument({renderer,scene,camera,controls,api,parts,display,model,clearSelection,pipeline}){
 const gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 let recording=false,last=null,serial=0,start=0,epoch=0,disjoint=0,programsBefore=[];
 const frameCosts=[],samples=[],gpu=[],queries=[],draw=pipeline.render.bind(pipeline);
 function poll(){
  if(!ext)return;
  if(gl.getParameter(ext.GPU_DISJOINT_EXT)){disjoint++;for(const q of queries)gl.deleteQuery(q.query);queries.length=0;return}
  while(queries.length&&gl.getQueryParameter(queries[0].query,gl.QUERY_RESULT_AVAILABLE)){const q=queries.shift();if(q.epoch===epoch)gpu.push(gl.getQueryParameter(q.query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q.query)}
 }
 pipeline.render=()=>{
  const now=performance.now();let query;
  if(recording){poll();if(last!==null)samples.push({intervalMs:now-last});last=now;if(ext&&serial++%4===0&&queries.length<8){query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query)}}
  try{draw()}finally{if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push({query,epoch})}}
  if(recording)frameCosts.push({pipelineCpuMs:performance.now()-now,callbackCpuMs:renderer.__integrationFrameStart?performance.now()-renderer.__integrationFrameStart:null});
  if(recording&&samples.length)Object.assign(samples.at(-1),{cpuMs:performance.now()-now,callbackCpuMs:renderer.__integrationFrameStart?performance.now()-renderer.__integrationFrameStart:null,draws:renderer.info.render.calls,triangles:renderer.info.render.triangles,depthMode:pipeline.guard.state.active,capturePixels:renderer.__acrylicCopyPixels||0});
 };
 function ownership(){const g=new Set(),m=new Set(),t=new Set();model.traverse(o=>{if(o.isMesh){g.add(o.geometry);for(const mat of [o.material].flat()){m.add(mat);for(const value of Object.values(mat))if(value?.isTexture)t.add(value)}}});return {geometries:g.size,materials:m.size,textures:t.size,captures:renderer.__renderCopies.size,warmMaterials:pipeline.state().warmMaterials}}
 const memory=()=>({renderer:renderer.info.memory,viewportCopies:[...renderer.__renderCopies.values()]});
 window.__architecture={renderer,scene,camera,controls,api,parts,display,model,clearSelection,memory,ownership,backend:'legacy-webgl',depthGuard:pipeline.guard,culling:pipeline.culling,shadowOptimization:pipeline.shadow,occlusion:pipeline.occlusion,fxaa:pipeline.fxaa,
  logicalTriangles:()=>{let n=0;model.traverse(m=>{if(m.isMesh)n+=(m.geometry.index?.count||m.geometry.attributes.position.count)/3});return n},
  hardware:()=>{const debug=gl.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,viewport:[renderer.domElement.clientWidth,renderer.domElement.clientHeight],buffer:[renderer.domElement.width,renderer.domElement.height],samples:gl.getParameter(gl.SAMPLES),logarithmicDepthBuffer:renderer.capabilities.logarithmicDepthBuffer}},
  begin(){programsBefore=renderer.info.programs.map(p=>p.id);epoch++;disjoint=0;frameCosts.length=0;samples.length=0;gpu.length=0;last=null;serial=0;start=performance.now();recording=true},
  end(){recording=false;poll();return {elapsedMs:performance.now()-start,samples:[...samples],gpuMs:[...gpu],frameCosts:[...frameCosts],newPrograms:renderer.info.programs.filter(p=>!programsBefore.includes(p.id)).map(p=>({name:p.name,cacheKey:p.cacheKey})),gpuTimingSupported:!!ext,gpuDisjointCount:disjoint,unresolvedQueries:queries.length}}
 };
}
