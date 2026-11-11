// Test clock only: submit the unchanged controller workload at 60 Hz even on
// a 30 Hz monitor. This establishes work rate, NEVER presentation cadence.
const timer=new URLSearchParams(location.search).get('clock')==='timer60';
let deadline=null;
window.__renderClock={mode:timer?'timer60-workload':'display-raf',targetHz:timer?60:null,presentationQualification:false};
export function requestRenderTick(callback){
 if(!timer)return requestAnimationFrame(callback);
 const now=performance.now();if(deadline===null||now-deadline>1000/60)deadline=now;
 deadline+=1000/60;return setTimeout(()=>callback(performance.now()),Math.max(0,deadline-now));
}
export function cancelRenderTick(handle){if(timer){clearTimeout(handle);deadline=null}else cancelAnimationFrame(handle)}
