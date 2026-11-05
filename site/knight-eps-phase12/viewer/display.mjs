import * as THREE from 'three';
import {normalizeTelemetry,telemetryHealth} from './telemetry.mjs';
export {normalizeTelemetry} from './telemetry.mjs';
export function createDisplay({onStatus,onTelemetry,staleMs=15000}){
 const canvas=document.createElement('canvas');canvas.width=768;canvas.height=582;
 canvas.setAttribute('aria-label','Miner LCD: same snapshot as telemetry panel');
 const ctx=canvas.getContext('2d'),texture=new THREE.CanvasTexture(canvas);
 texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.flipY=false;
 const presets={standby:{message:'READY',lines:['Waiting for workload']},mining:{message:'MINING',lines:['Illustrative screen state']},low_power:{message:'LOW POWER',lines:['Illustrative screen state']},offline:{message:'OFFLINE',lines:['Presentation state']}};
 const savedStates={};let presentation={state:'telemetry',title:'KNIGHT EPS',message:null,lines:[]};
 let bindingBasis=null,source='none',screen=null,originalMaterial=null,last=null,receivedAt=0,stream=null,transport='waiting',error=null,disposed=false;
 function state(){return {source,presentation:{...presentation,lines:[...presentation.lines]},display:screen?'bound':'awaiting_asset',bindingBasis,screen:screen?.name||null,...telemetryHealth({last,receivedAt,source,transport,error,staleMs}),readings:last?{...last}:null,receivedAt:receivedAt||null,transport,error}}
 function draw(){
  const s=state();ctx.fillStyle='#081b22';ctx.fillRect(0,0,768,582);
  ctx.fillStyle='#edcf8c';ctx.font='bold 48px monospace';ctx.fillText(presentation.title,32,70,704);
  ctx.fillStyle='#e1f0ec';ctx.font='30px monospace';
  ctx.fillText(presentation.state==='telemetry'?s.label.toUpperCase():presentation.message||'PRESENTATION',32,145,704);
  if(presentation.state==='telemetry'){
   const f=k=>typeof last?.[k]==='number'?last[k].toFixed(2):'--';
   ctx.font='40px monospace';ctx.fillText(`BAT ${f('battery_voltage_v')} V`,32,270);ctx.fillText(`SOL ${f('solar_panel_current_a')} A`,32,350);
   if(last?.status){ctx.font='23px monospace';ctx.fillText(last.status,32,426,704)}
  }else{ctx.font='30px monospace';presentation.lines.slice(0,2).forEach((x,i)=>ctx.fillText(x,32,270+60*i,704))}
  ctx.fillStyle='#a7c7c3';ctx.font='24px monospace';
  const provenance=source==='mock'?'MOCK / SYNTHETIC':source==='live'?'DASHBOARD':'NO DATA';
  ctx.fillText(`${provenance}${s.ageMs===null?'':` · ${Math.floor(s.ageMs/1000)}s ago`}`,32,535,704);
  texture.needsUpdate=true;onStatus?.(s);
 }
 function useTelemetryMode(){presentation={state:'telemetry',title:'KNIGHT EPS',message:null,lines:[]};draw()}
 function setScreenState(name,overrides={}){
  if(disposed)throw Error('Display disposed');if(name!=='telemetry'&&!presets[name])throw new TypeError('Unknown screen state');
  if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))throw new TypeError('Screen content must be an object');
  const base=presets[name]||{message:null,lines:[]},saved=savedStates[name];
  const next=saved?{...saved,lines:[...saved.lines]}:{state:name,title:'KNIGHT EPS',message:base.message,lines:[...base.lines]};
  for(const [key,max] of [['title',30],['message',64]])if(overrides[key]!==undefined){if(typeof overrides[key]!=='string')throw new TypeError(`${key} must be text`);next[key]=overrides[key].slice(0,max)}
  if(overrides.lines!==undefined){if(!Array.isArray(overrides.lines)||overrides.lines.some(x=>typeof x!=='string'))throw new TypeError('lines must be text strings');next.lines=overrides.lines.slice(0,2).map(x=>x.slice(0,40))}
  presentation=next;savedStates[name]={...next,lines:[...next.lines]};draw();return state();
 }
 function update(input,{source:origin='live'}={}){
  if(disposed)throw Error('Display disposed');if(!['live','mock'].includes(origin))throw new TypeError('Source must be live or mock');
  const packet=normalizeTelemetry(input);source=origin;last=packet;receivedAt=Date.now();error=null;
  if(!stream)transport='dashboard';presentation={state:'telemetry',title:'KNIGHT EPS',message:null,lines:[]};draw();onTelemetry?.(state());return state();
 }
 function setTransport(value){if(!['connecting','connected','disconnected','waiting'].includes(value))throw new TypeError('Unknown transport state');transport=value;error=null;draw()}
 function disconnect(){if(stream){stream.close();stream=null}transport='disconnected';error=null;draw()}
 function reset(){source='none';last=null;receivedAt=0;error=null;if(!stream)transport='waiting';draw();onTelemetry?.(state())}
 function connectSSE(url='/telemetry/events',{eventName='message',map=x=>x,source:origin='live'}={}){
  if(disposed)throw Error('Display disposed');const u=new URL(url,location.href);
  if(u.origin!==location.origin)throw Error('Telemetry endpoint must be same-origin');
  if(typeof map!=='function')throw new TypeError('map must be a function');if(!['live','mock'].includes(origin))throw new TypeError('Source must be live or mock');
  disconnect();reset();source=origin;transport='connecting';stream=new EventSource(u.href);draw();
  stream.addEventListener(eventName,e=>{try{update(map(JSON.parse(e.data)),{source:origin})}catch(err){error=`Invalid packet: ${err.message}`;draw()}});
  stream.onopen=()=>{transport='connected';error=null;draw()};
  stream.onerror=()=>{transport='connecting';error='Connection interrupted · retrying';draw()};return disconnect;
 }
 function unbind(){if(screen){screen.material.dispose();screen.material=originalMaterial;screen=null;originalMaterial=null;bindingBasis=null}draw()}
 function bind(mesh,{authentic=false,supplied=false}={}){
  if(!authentic&&!(supplied&&mesh?.userData.display_surface===true))throw Error('Confirm a dedicated supplied screen surface');
  if(!mesh?.isMesh||!mesh.geometry.getAttribute('uv'))throw Error('Screen must be a dedicated UV-mapped mesh');
  if(mesh.userData.component_id==='NerdMiner_Proxy'||/proxy|placeholder/i.test(mesh.name))throw Error('Proxy cannot be an authentic display');
  unbind();screen=mesh;originalMaterial=mesh.material;bindingBasis=supplied?'user_supplied_surface':'caller_confirmed_authentic';
  screen.material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,toneMapped:false});draw();return state();
 }
 const timer=setInterval(draw,1000);draw();
 return {canvas,texture,useTelemetryMode,setScreenState,getScreenStates:()=>structuredClone(savedStates),update,reset,setTransport,bind,unbind,connectSSE,disconnect,state,dispose:()=>{disconnect();unbind();clearInterval(timer);texture.dispose();disposed=true}};
}
