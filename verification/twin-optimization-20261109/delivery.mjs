const viewer=document.querySelector('#viewer'),status=document.querySelector('#status'),output=document.querySelector('#summary');
const saved=JSON.parse(sessionStorage.getItem('twin-delivery-pilot-v2')||'{"instrumentationVersion":2,"runs":[]}');let receive=null;
const save=async()=>{sessionStorage.setItem('twin-delivery-pilot-v2',JSON.stringify(saved));await fetch('/__delivery_result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(saved)})};
addEventListener('message',e=>{if(e.origin===location.origin&&e.source===viewer.contentWindow&&e.data.kind==='pilot-result')receive?.(e.data.report)});
async function run(variant,cache,mode,round){
 status.textContent=`Running ${mode}: ${variant}, ${cache}, round ${round}`;
 if(viewer.contentWindow?.__deliveryCleanup)viewer.contentWindow.__deliveryCleanup();
 const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Pilot timed out')),90000);receive=data=>{clearTimeout(timeout);resolve(data)};viewer.src=`/site/knight-eps-phase12/viewer/?pilot=${variant}&cache=${cache}&mode=${mode}&round=${round}`});
 saved.runs.push({...result,cache,mode,round});await save();output.textContent=JSON.stringify(saved.runs.map(r=>({variant:r.variant,cache:r.cache,mode:r.mode,round:r.round,error:r.error,loading:r.loadingSummary,estimatedTextureMiB:r.residency?.estimatedMaterialTextureBytes/1048576,interactions:r.interactions})),null,2);
 if(result.error)throw Error(result.error);
}
async function suite(mode){
 for(const b of document.querySelectorAll('button'))b.disabled=true;
 try{
  if(mode==='load')for(let round=1;round<=3;round++)for(const variant of ['original','ktx2','meshopt'])for(const cache of ['cold','warm'])await run(variant,cache,mode,round);
  else for(const variant of ['original','ktx2','meshopt']){
   const hasTiming=saved.runs.some(r=>r.variant===variant&&r.interactions?.some(i=>'total' in i.gpuPassMs));
   await run(variant,'warm',mode==='artwork'?'artwork':hasTiming?'visual':mode,1);
  }
  status.textContent=`Complete: ${mode} comparison saved`;saved.lastCompleted=mode;await save();
 }catch(e){status.textContent='Failed: '+e.message;output.textContent=e.stack}
 finally{for(const b of document.querySelectorAll('button'))b.disabled=false}
}
document.querySelector('#loads').onclick=()=>suite('load');document.querySelector('#full').onclick=()=>suite('full');
document.querySelector('#artwork').onclick=()=>suite('artwork');
