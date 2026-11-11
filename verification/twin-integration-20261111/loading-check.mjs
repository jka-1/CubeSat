// Dedicated local Chrome profile only; no production traffic or hardware.
import fs from 'node:fs/promises';
const label=process.argv[2]||'after',mbps=Number(process.argv[3]||20),mobile=process.argv[4]==='mobile';
const root=new URL('../../',import.meta.url),results=new URL('./results/',import.meta.url);
const version=await fetch('http://127.0.0.1:9227/json/version').then(r=>r.json());
const socket=new WebSocket(version.webSocketDebuggerUrl),pending=new Map(),errors=[];let id=0,session;
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
function send(method,params={},s=session){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params,...(s?{sessionId:s}:{})}))})}
socket.onmessage=async e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}
 else if(m.method==='Fetch.requestPaused'){
  const loader=m.params.request.url.includes('model-loader.mjs');
  let source=await fs.readFile(new URL('site/knight-eps-phase12/viewer/'+(loader?'rendering/model-loader.mjs':'main.mjs'),root),'utf8');
  if(loader)source=source.replace('export async function loadDisplayModel(timing={}){','export async function loadDisplayModel(timing={}){\n window.__loading.modelStart=performance.now();').replace('let certified=false;','window.__loading.downloaded=performance.now();let certified=false;').replace('const gltf=await loader.parseAsync(bytes,base.href);','window.__loading.decoded=performance.now();const gltf=await loader.parseAsync(bytes,base.href);window.__loading.parsed=performance.now();');
  else source='window.__loading={boot:performance.now()};\n'+source.replace('preparing=pipeline.warm(()=>disposed);await preparing;','window.__loading.warmStart=performance.now();preparing=pipeline.warm(()=>disposed);await preparing;window.__loading.warmEnd=performance.now();').replace("window.dispatchEvent(new CustomEvent('knighteps:ready'", "window.__loading.ready=performance.now();window.dispatchEvent(new CustomEvent('knighteps:ready'");
  await send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(source).toString('base64')});
 }else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
};
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
try{
 const target=(await send('Target.getTargets',{},null)).targetInfos.find(t=>t.type==='page');session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1290,height:mobile?844:720,deviceScaleFactor:2,mobile});
 if(mbps)await send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:mbps*1e6/8,uploadThroughput:mbps*1e6/8});
 await send('Fetch.enable',{patterns:[{urlPattern:'*viewer/main.mjs*'},{urlPattern:'*viewer/rendering/model-loader.mjs*'}]});
 await send('Page.bringToFront');await send('Page.navigate',{url:'http://127.0.0.1:8770/site/knight-eps-phase12/viewer/'});
 for(let n=0;n<240;n++){if(await evaluate('!!window.knightEPSTwin'))break;await new Promise(r=>setTimeout(r,250))}
 await evaluate('knightEPSTwin.ready.then(()=>knightEPSTwin.readyForImage)');
 const report=await evaluate(`({timing:window.__loading,performance:knightEPSTwin.performance(),parts:knightEPSTwin.state().parts.length,resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/models/')||r.name.includes('/viewer/')).map(r=>({name:new URL(r.name).pathname,duration:r.duration,encoded:r.encodedBodySize,decoded:r.decodedBodySize,transfer:r.transferSize})),navigationMs:performance.now()})`);
 const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:mobile?390:1290,height:mobile?844:720,scale:.5}});
 await fs.writeFile(new URL(`loading-${label}.png`,results),Buffer.from(shot.data,'base64'));
 await fs.writeFile(new URL(`loading-${label}.json`,results),JSON.stringify({label,mbps,mobile,...report,errors},null,2)+'\n');
 console.log(JSON.stringify({label,mbps,mobile,timing:report.timing,loading:report.performance.loading,warm:report.performance.rendering.warmMs,navigationMs:report.navigationMs,errors:errors.length}));
 if(errors.length||report.parts!==95)throw Error('Viewer loading failed');
}finally{await send('Fetch.disable');await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await send('Network.setCacheDisabled',{cacheDisabled:false});socket.close()}
