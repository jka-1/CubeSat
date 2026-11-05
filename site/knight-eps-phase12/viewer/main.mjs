import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createDisplay,normalizeTelemetry} from './display.mjs';
import {frameCamera,projectedBounds} from './framing.mjs';

const qs=s=>document.querySelector(s), panel=qs('#canvas');
const proposed=true;
const errorBox=qs('#render-error');
function fail(error){qs('#loader-status').textContent='Assembly unavailable';errorBox.hidden=false;errorBox.textContent=`${error.message}. ${/WebGL|graphics context/i.test(error.message)?'This browser could not start 3D graphics. Use a WebGL2-capable browser with graphics acceleration, then reload.':'Serve the package over HTTP and confirm the models and docs folders are present, then reload.'}`;console.error(error)}
let renderer;
// PCB copper and mask layers are separated by tens of micrometers. Preserve
// their depth ordering across focus/zoom distances without altering the model.
try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,logarithmicDepthBuffer:true})}catch(error){fail(error)}
if(renderer)start();
function start(){
 let cameraTransition=null,hasFramed=false,studioFloor=null,quality='performance';
 const metrics={fitCount:0,fitMs:0,resizeCount:0};
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,quality==='studio'?2:1));renderer.setClearColor(0xe6eaed);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;
 renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','Knight EPS assembly. Orbit with drag, zoom with scroll; all components are also selectable from the list.');panel.append(renderer.domElement);
 const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(38,1,.002,30);camera.up.set(0,1,0);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=.035;controls.maxDistance=5;controls.addEventListener('start',()=>{cancelCamera();});
 function cancelCamera(){cameraTransition=null;pendingFit=false;}
 const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();const env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.8;room.dispose();pmrem.dispose();
 scene.add(new THREE.HemisphereLight(0xffffff,0x6b7785,.4));const lamp=new THREE.DirectionalLight(0xffffff,2.0);lamp.position.set(.5,.9,.4);scene.add(lamp);const fill=new THREE.DirectionalLight(0xdce8ff,.8);fill.position.set(-.6,.25,-.6);scene.add(fill);renderer.shadowMap.enabled=false;renderer.shadowMap.type=THREE.PCFSoftShadowMap;lamp.castShadow=true;lamp.shadow.mapSize.set(1024,1024);Object.assign(lamp.shadow.camera,{left:-.65,right:.65,top:.65,bottom:-.65,near:.1,far:3});lamp.shadow.bias=-.00015;lamp.shadow.normalBias=.0006;lamp.shadow.radius=3;
 let metadata={components:{}},meshes=[],selected=null,model=null,loaded=false,topRemoved=false,exploded=false,xray=false,extracted=false,disposed=false;
 let coverProgress=0,coverLiftProgress=0,orbitMode='satellite',pendingFit=false,mockTimer=null,mockCounter=0;const coverPivots={};const initial=new Map(),baseMaterials=new Map(),materialDefaults=new Map(),owners=new WeakMap(),partVis=new Map(),vis=new Map();
 const groups={chassis:'Chassis',removable_cover:'Cover + light sensor',wings:'Wing arms',panels:'Solar panels',side_wall_electronics:'Side-wall PCBs',floor_electronics:'Floor PCBs',rear_wall_electronics:'Temperature sensor',battery_assembly:'Battery pack',pcb_fixtures:'PCB fixtures',miner:'NerdMiner payload'};
 const raycaster=new THREE.Raycaster(),mouse=new THREE.Vector2();const assemblyVectors=new Map();const center=new THREE.Vector3(0,.2,0);let radius=.38;let cameraView='iso';const cadFromWorldRotation=new THREE.Matrix4();
 const info=n=>metadata.components[n]||{label:n,group:'other',provisional:true};const pressed=(id,value)=>{qs(id).setAttribute('aria-pressed',String(value));qs(id).classList.toggle('active',value)};
 function requestFrame(){cancelCamera();pendingFit=true}
 function stopMock({reset=false}={}){if(mockTimer)clearInterval(mockTimer);mockTimer=null;if(reset)display.reset()}
 function receiveTelemetry(input,options={}){normalizeTelemetry(input);if(options.source!=='mock')stopMock();return display.update(input,options)}
 function startMock(){stopMock();display.disconnect();mockCounter=0;const tick=()=>{const t=mockCounter++;receiveTelemetry({battery_voltage_v:15.2+.12*Math.sin(t/5),solar_panel_current_a:.4+.08*Math.sin(t/3),temperature_c:27+.5*Math.sin(t/7),esp32_temperature_c:36+.3*Math.sin(t/8),mppt_switch_temperature_c:32+.4*Math.sin(t/6),light_level:70+8*Math.sin(t/4),status:'MOCK SOLAR INPUT'},{source:'mock'})};tick();mockTimer=setInterval(tick,1000);return ()=>stopMock()}
 qs('#data-source').onchange=()=>{if(qs('#data-source').value==='mock')startMock();else{stopMock();display.disconnect();display.reset();display.useTelemetryMode();qs('#source-note').textContent='Waiting for dashboard / live data.'}};
 const display=createDisplay({onStatus:s=>{
  qs('#display-status').textContent=s.display==='bound'?'Miner LCD connected':'Miner LCD loading';
  qs('#telemetry-status').textContent=s.label;qs('#telemetry-status').dataset.state=s.health;
  qs('#source-note').textContent=s.source==='mock'?'MOCK · synthetic demonstration data':s.source==='live'?'Dashboard telemetry':'Waiting for dashboard data';
  qs('#last-update').textContent=s.receivedAt?`Last update ${Math.floor((Date.now()-s.receivedAt)/1000)} s ago`:'No packet received';
  for(const el of document.querySelectorAll('[data-reading]')){const value=s.readings?.[el.dataset.reading];el.textContent=typeof value==='number'?value.toFixed(Number(el.dataset.precision||1))+' '+(el.dataset.unit||''):'—'}
  if(['live','mock'].includes(s.source))qs('#data-source').value=s.source;
  updateBriefReadings(s);
 }});
 qs('#screen-preview').append(display.canvas);qs('#include-fixtures').onchange=listParts;
 qs('#screen-state').onchange=()=>{const s=display.setScreenState(qs('#screen-state').value).presentation;qs('#screen-title').value=s.title;qs('#screen-message').value=s.message||'NO TELEMETRY'};
 qs('#apply-screen').onclick=()=>display.setScreenState(qs('#screen-state').value,{title:qs('#screen-title').value,message:qs('#screen-message').value});
 function visibleBounds(){scene.updateMatrixWorld(true);const b=new THREE.Box3();for(const m of meshes)if(m.visible)b.expandByObject(m);return b}
 // Orbit target is a stable physical anchor. Projection offset composes the silhouette
 // independently, without moving any model geometry or making selection change the pivot.
 function flushDamping(){const old=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=old}
 // Cached local mesh bounds: conservative framing without scanning a million vertices.
 function geometryPoints(parts=meshes.filter(m=>m.visible)){
  scene.updateMatrixWorld(true);const points=[];
  for(const part of parts)eachRenderMesh(part,m=>{
   if(!m.geometry.boundingBox)m.geometry.computeBoundingBox();const b=m.geometry.boundingBox;
   for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])points.push(new THREE.Vector3(x,y,z).applyMatrix4(m.matrixWorld));
  });return points;
 }
 function projectionBounds(points){return projectedBounds(camera,points)}
 function fit(kind=null,box=null){
  const fitStart=performance.now();pendingFit=false;cameraTransition=null;flushDamping();if(!loaded)return;
  const before={position:camera.position.clone(),target:controls.target.clone(),shift:[camera.view?.offsetX/(camera.view?.fullWidth||1)||0,camera.view?.offsetY/(camera.view?.fullHeight||1)||0]};
  if(kind)cameraView=kind;
  const c=box?box.getCenter(new THREE.Vector3()):center.clone();
  const parts=box&&selected?[selected]:meshes.filter(m=>m.visible);
  const points=box?(()=>{const a=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])a.push(new THREE.Vector3(x,y,z));return a})():geometryPoints(parts);
  if(!points.length)return;
  const dirs={iso:[-1,1.05,1.25],top:[0,1,.0001],bottom:[0,-1,.0001],side:[0,0,1],front:[-1,.001,0],rear:[1,.001,0],miner:[-1,.18,.3]};
  const dir=kind?new THREE.Vector3(...dirs[kind]).normalize():camera.position.clone().sub(controls.target).normalize();
  if(!dir.lengthSq())dir.set(-1,1,1).normalize();
  if(kind)camera.up.set(...(['top','bottom'].includes(kind)?[0,0,-1]:[0,1,0]));
  controls.target.copy(c);
  const framed=frameCamera(camera,points,c,dir,panel.clientWidth,panel.clientHeight);if(!framed)return;
  controls.maxDistance=Math.max(5,framed.extent*20);const [sx,sy]=framed.shift;
  controls.update();camera.updateMatrixWorld(true);
  if(hasFramed&&!reduced.matches){cameraTransition={start:performance.now(),before,position:camera.position.clone(),target:controls.target.clone(),shift:[sx,sy]};camera.position.copy(before.position);controls.target.copy(before.target);camera.setViewOffset(panel.clientWidth,panel.clientHeight,before.shift[0]*panel.clientWidth,before.shift[1]*panel.clientHeight,panel.clientWidth,panel.clientHeight);controls.update()}
  hasFramed=true;metrics.fitCount++;metrics.fitMs=performance.now()-fitStart;
 }
 function fitModel(kind=null){orbitMode='satellite';fit(kind)}
 function viewMiner(){select(meshes.find(m=>m.name==='NerdMiner_Board_LCD'));orbitMode='focus';fit('miner',new THREE.Box3().setFromObject(model.getObjectByName('NerdMiner_Heltec_V2')))}
 qs('#reset-camera').onclick=()=>fitModel('iso');qs('#miner-view').onclick=viewMiner;
 function eachRenderMesh(part,fn){part.traverse(m=>{if(m.isMesh)fn(m)})}
 function applyMaterials(){for(const part of meshes)eachRenderMesh(part,m=>{if(display.state().screen===m.name)return;const p=info(part.name),mat=baseMaterials.get(m),base=materialDefaults.get(m);if(m.material!==mat)m.material=mat;const transparent=xray&&['chassis','removable_cover'].includes(p.group)&&part.name!=='LightSensor';mat.transparent=transparent||base.transparent;mat.opacity=transparent?.18:base.opacity;mat.depthWrite=transparent?false:base.depthWrite;mat.emissive.copy(selected===part?new THREE.Color('#529ba9'):base.emissive);mat.emissiveIntensity=selected===part?.16:base.emissiveIntensity;mat.needsUpdate=true})}
 function updateBriefReadings(state){const el=qs('#selected-readings');if(!el||!selected)return;const fields=info(selected.name).display_info?.fields||[];const labels={battery_voltage_v:['Battery','V'],solar_panel_current_a:['Solar input (shared)','A'],esp32_temperature_c:['MCU temperature','°C'],mppt_switch_temperature_c:['Charger temperature','°C'],temperature_c:['Temperature','°C'],light_level:['Relative light','']};el.replaceChildren();for(const key of fields){const [label,unit]=labels[key]||[key,''];const line=document.createElement('p');line.textContent=`${label}: ${typeof state.readings?.[key]==='number'?state.readings[key].toFixed(2)+' '+unit:'No data'}`;el.append(line)}}
 function briefDetail(){const el=qs('#detail');el.replaceChildren();qs('#focus-selected').disabled=!selected;if(!selected){const p=document.createElement('p');p.textContent='Click a part in the model or search by name.';el.append(p);return}const p=info(selected.name),d=p.display_info||{};const title=document.createElement('strong');title.textContent=d.name||p.label;const model=document.createElement('p');model.className='part-model';model.textContent=d.model||'';model.hidden=!d.model||d.model===d.name;const purpose=document.createElement('p');purpose.textContent=d.purpose||p.description;el.append(title,model,purpose);if(d.fields?.length){const readings=document.createElement('div');readings.id='selected-readings';el.append(readings);updateBriefReadings(display.state())}if(d.links?.length){const links=document.createElement('div');links.className='part-links';for(const link of d.links){const a=document.createElement('a');a.href=link.url;a.textContent=link.label;a.target='_blank';a.rel='noopener noreferrer';links.append(a)}el.append(links)}}
 function detail(){briefDetail()}
 function select(part){extracted=false;selected=part;applyMaterials();detail();if(part){qs('.sidebar').scrollTop=0;if(matchMedia('(max-width:760px)').matches)qs('.detail').scrollIntoView({block:'nearest',behavior:'instant'})}for(const b of qs('#parts').querySelectorAll('button')){const on=b.dataset.name===part?.name;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))}window.dispatchEvent(new CustomEvent('knighteps:selection',{detail:part?{id:part.name,...info(part.name)}:null}));return part?.name||null}
 function syncVisibility(){for(const m of meshes)m.visible=vis.get(info(m.name).group)!==false&&partVis.get(m.name)!==false&&(!info(m.name).cover_attached||vis.get('removable_cover')!==false);}
 function listParts(){const term=qs('#filter').value.trim().toLowerCase();qs('#parts').replaceChildren();let count=0;
 for(const m of meshes){const p=info(m.name);if(!term&&!qs('#include-fixtures').checked&&(p.group==='pcb_fixtures'||/NerdMiner_(Brass|Front_spacer|Screw)/.test(m.name)))continue;if(!`${m.name} ${p.label} ${p.group} ${p.description} ${p.display_info?.model||''} ${p.display_info?.purpose||''}`.toLowerCase().includes(term))continue;count++;
 const row=document.createElement('div');row.className='part-row';const cb=document.createElement('input');cb.type='checkbox';cb.checked=m.visible;cb.setAttribute('aria-label',`Show ${p.label}`);cb.onchange=()=>{if(cb.checked){vis.set(p.group,true);const group=qs(`[data-group="${p.group}"]`);if(group)group.checked=true;if(p.cover_attached){vis.set('removable_cover',true);qs('[data-group="removable_cover"]').checked=true}}partVis.set(m.name,cb.checked);syncVisibility();listParts()};
 const b=document.createElement('button');b.dataset.name=m.name;b.textContent=p.label;b.setAttribute('aria-pressed',String(selected===m));b.classList.toggle('active',selected===m);b.onclick=()=>select(m);row.append(cb,b);qs('#parts').append(row)}qs('#empty-parts').hidden=count!==0;if(proposed)qs('#browse-summary').textContent=term?`${count} matching components`:`Browse ${count} components`;
 }
 function createChecks(){const wrap=qs('#visibility');wrap.replaceChildren();for(const [group,label] of Object.entries(groups)){vis.set(group,group!=='payload');const lab=document.createElement('label'),cb=document.createElement('input');cb.type='checkbox';cb.dataset.group=group;cb.checked=group!=='payload';cb.onchange=()=>{vis.set(group,cb.checked);syncVisibility();listParts()};lab.append(cb,document.createTextNode(label));wrap.append(lab)}}
 qs('#filter').oninput=()=>{qs('#browse-parts').open=true;listParts()};
 qs('#top-toggle').onclick=()=>{if(exploded)return;topRemoved=!topRemoved;pressed('#top-toggle',topRemoved);qs('#top-toggle').textContent=topRemoved?'Close lid':'Open lid';requestFrame()};
 qs('#explode-toggle').onclick=()=>{exploded=!exploded;topRemoved=false;qs('#top-toggle').disabled=exploded;pressed('#top-toggle',topRemoved);qs('#top-toggle').textContent=exploded?'Lid lifted':'Open lid';pressed('#explode-toggle',exploded);qs('#explode-toggle').textContent=exploded?'Reassemble':'Explode assembly';requestFrame()};
 qs('#xray-toggle').onclick=()=>{xray=!xray;pressed('#xray-toggle',xray);applyMaterials()};
 function reset(){orbitMode='satellite';qs('#top-toggle').disabled=false;topRemoved=false;exploded=false;xray=false;extracted=false;for(const id of ['#top-toggle','#explode-toggle','#xray-toggle'])pressed(id,false);qs('#top-toggle').textContent='Open lid';qs('#explode-toggle').textContent='Explode assembly';partVis.clear();createChecks();syncVisibility();select(null);listParts();if(loaded)fitModel('iso');requestFrame()}
 qs('#reset-assembly').onclick=reset;
 function inspectMounts(){reset();for(const group of ['panels','wings','removable_cover']){vis.set(group,false);const input=qs(`[data-group="${group}"]`);if(input)input.checked=false}xray=true;pressed('#xray-toggle',true);syncVisibility();applyMaterials();fit('iso');select(meshes.find(m=>m.name==='Charger_BMS034A_EVM'));}
 
 qs('#focus-selected').onclick=()=>{if(selected){orbitMode='focus';fit('iso',new THREE.Box3().setFromObject(selected))}};
 let pointerStart=null;renderer.domElement.addEventListener('pointerdown',e=>{pointerStart=[e.clientX,e.clientY,e.pointerId]});
 renderer.domElement.addEventListener('pointerup',e=>{if(e.button!==0||!pointerStart||pointerStart[2]!==e.pointerId||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5){pointerStart=null;return}pointerStart=null;const rect=renderer.domElement.getBoundingClientRect();mouse.set(2*(e.clientX-rect.left)/rect.width-1,1-2*(e.clientY-rect.top)/rect.height);raycaster.setFromCamera(mouse,camera);select(owners.get(raycaster.intersectObjects(meshes.filter(m=>m.visible),true)[0]?.object)||null)});
 renderer.domElement.addEventListener('pointercancel',()=>pointerStart=null);
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();fail(Error('3D graphics context lost; reload to restore the viewer'))});
 const url=new URL('../models/KnightEPS_Phase10.glb',import.meta.url),manifestUrl=new URL('../docs/component_manifest.json',import.meta.url);
 const ready=Promise.all([fetch(manifestUrl,{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error(`Manifest HTTP ${r.status}`);return r.json()}),new GLTFLoader().loadAsync(url.href)]).then(([data,gltf])=>{
 metadata=data;model=gltf.scene;scene.add(model);for(const [leaf,cfg] of Object.entries(metadata.cover_animation.pivots)){const object=model.getObjectByName(cfg.name);coverPivots[leaf]={object,angle:cfg.angle_rad,initial:object.position.clone()}}cadFromWorldRotation.fromArray(metadata.orientation.cad_to_gltf_root_matrix_column_major).invert();
 for(const id of Object.keys(metadata.components)){const obj=model.getObjectByName(id);if(!obj)throw Error(`Component missing geometry: ${id}`);meshes.push(obj);initial.set(obj,obj.position.clone());eachRenderMesh(obj,m=>{owners.set(m,obj);m.castShadow=!m.material.transparent;m.receiveShadow=!['floor_electronics','side_wall_electronics','rear_wall_electronics'].includes(info(id).group)&&id!=='LightSensor';m.material=m.material.clone();if(m.material.map)m.material.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());baseMaterials.set(m,m.material);materialDefaults.set(m,{transparent:m.material.transparent,opacity:m.material.opacity,depthWrite:m.material.depthWrite,emissive:m.material.emissive.clone(),emissiveIntensity:m.material.emissiveIntensity})})}
 scene.updateMatrixWorld(true);const chassisBounds=new THREE.Box3();for(const part of meshes)if(info(part.name).group==='chassis')chassisBounds.expandByObject(part);chassisBounds.getCenter(center);radius=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).length()/2;
 const floorBounds=new THREE.Box3().setFromObject(model);const floor=new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.ShadowMaterial({opacity:.14}));floor.rotation.x=-Math.PI/2;floor.position.y=floorBounds.min.y-.004;floor.receiveShadow=true;scene.add(floor);studioFloor=floor;
 display.bind(model.getObjectByName(metadata.display.mesh_name),{supplied:true});
 const grouped=new Map();for(const m of meshes){const key=info(m.name).assembly_id;if(!grouped.has(key))grouped.set(key,new THREE.Box3());grouped.get(key).expandByObject(m)}
 for(const [key,b] of grouped){let v=b.getCenter(new THREE.Vector3()).sub(center);if(v.length()<.01)v.set(0,0,1);assemblyVectors.set(key,v.transformDirection(cadFromWorldRotation).multiplyScalar(.085))}
 loaded=true;createChecks();listParts();syncVisibility();applyMaterials();fit('iso');qs('#loader-status').textContent='Ready';
 for(const id of ['#top-toggle','#explode-toggle','#xray-toggle','#reset-assembly'])qs(id).disabled=false;
 window.dispatchEvent(new CustomEvent('knighteps:ready',{detail:{parts:meshes.length}}));return api;
 }).catch(error=>{fail(error);throw error});
 // Public integration surface. No endpoints are opened until explicitly requested.
 const api={version:'12.0.0',setQuality,performance:()=>({...metrics,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles}),ready,
 setTelemetryTransport:(status)=>display.setTransport(status),
 setScreenState:(name,content)=>display.setScreenState(name,content),getScreenStates:()=>display.getScreenStates(),
 updateTelemetry:(input,options)=>receiveTelemetry(input,options),resetTelemetry:()=>display.reset(),startMockTelemetry:startMock,stopMockTelemetry:()=>stopMock({reset:true}),
 connectTelemetry:(url,options)=>{stopMock();display.useTelemetryMode();return display.connectSSE(url,options)},disconnectTelemetry:()=>display.disconnect(),
 bindDisplay:(name,options)=>{const mesh=model?.getObjectByName(name);if(!mesh)throw Error(`Screen mesh not found: ${name}`);return display.bind(mesh,options)},
 select:id=>{const m=meshes.find(x=>x.name===id);if(!m)throw Error(`Unknown component ${id}`);return select(m)},
 setVisible:(id,value)=>{if(typeof value!=='boolean')throw new TypeError('Visibility must be boolean');if(!meshes.some(m=>m.name===id))throw Error(`Unknown component ${id}`);partVis.set(id,value);syncVisibility();listParts()},
 focusMount:id=>{const members=meshes.filter(m=>info(m.name).mounting_id===id&&info(m.name).fixture_instance===1);if(!members.length)throw Error('No candidate fixtures for '+id);const box=new THREE.Box3();for(const m of members)box.expandByObject(m);const clip=members.find(m=>info(m.name).fixture_role==='clip')||members[0];select(clip);orbitMode='focus';fit('iso',box);cameraTransition=null;const target=box.getCenter(new THREE.Vector3()),distance=camera.position.distanceTo(target);const dir=new THREE.Vector3(.4,-1.8,.65).transformDirection(clip.matrixWorld);camera.up.copy(new THREE.Vector3(0,0,1).transformDirection(clip.matrixWorld));camera.position.copy(target).addScaledVector(dir,distance);controls.target.copy(target);controls.update()},
 capture:()=>{renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png')},
 inspectMounts,reset,fit:()=>fitModel(),focus:()=>qs('#focus-selected').click(),view:kind=>{if(kind==='miner')return viewMiner();if(!['iso','top','bottom','side','front','rear'].includes(kind))throw Error('Unknown camera view');fitModel(kind)},
 projectedBounds:()=>projectionBounds(geometryPoints()),
 state:()=>({loaded,quality,coverProgress,coverLiftProgress,orbitMode,camera:{target:controls.target.toArray(),position:camera.position.toArray(),up:camera.up.toArray(),chassisCenter:center.toArray(),aspect:camera.aspect,near:camera.near,far:camera.far,view:camera.view,viewport:[panel.clientWidth,panel.clientHeight],canvas:[renderer.domElement.clientWidth,renderer.domElement.clientHeight],pixelRatio:renderer.getPixelRatio()},materials:meshes.filter(p=>info(p.name).group==='miner').flatMap(p=>{const out=[];eachRenderMesh(p,m=>out.push({name:m.name,opacity:m.material.opacity,transparent:m.material.transparent,displayBound:display.state().screen===m.name}));return out}),ui:'finished',upAxis:'Y',springFlex:'omitted_by_user',selected:selected?.name||null,topRemoved,exploded,xray,extracted,display:display.state(),parts:meshes.map(m=>({id:m.name,visible:m.visible,position:m.position.toArray(),worldPosition:m.getWorldPosition(new THREE.Vector3()).toArray(),wallRole:info(m.name).wall_role,assembly:info(m.name).assembly_id,mountingId:info(m.name).mounting_id,fixtureRole:info(m.name).fixture_role,coverAttached:!!info(m.name).cover_attached}))}),
 dispose:()=>{stopMock();disposed=true;observer.disconnect();window.removeEventListener('resize',resize);controls.dispose();display.dispose();for(const part of meshes)eachRenderMesh(part,m=>{m.geometry.dispose();m.material.dispose()});studioFloor?.geometry.dispose();studioFloor?.material.dispose();env.dispose();renderer.dispose()}
 };
 window.knightEPSTwin=api;window.knightEPSDisplay={update:api.updateTelemetry,reset:api.resetTelemetry};ready.catch(()=>{});
 for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>fitModel(b.dataset.view);
 qs('#quality').onchange=()=>setQuality(qs('#quality').value);
 function setQuality(value){if(!['performance','studio'].includes(value))throw Error('Unknown quality');quality=value;qs('#quality').value=value;renderer.shadowMap.enabled=value==='studio';renderer.shadowMap.needsUpdate=true;for(const part of meshes)eachRenderMesh(part,m=>{if(m.material.map)m.material.map.anisotropy=Math.min(value==='studio'?8:2,renderer.capabilities.getMaxAnisotropy())});resize();return quality}
 qs('#fit-model').onclick=()=>fitModel();qs('#zoom-in').onclick=()=>{cancelCamera();flushDamping();camera.position.sub(controls.target).multiplyScalar(.82).add(controls.target);controls.update()};qs('#zoom-out').onclick=()=>{cancelCamera();flushDamping();camera.position.sub(controls.target).multiplyScalar(1.22).add(controls.target);controls.update()};document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='f'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){e.preventDefault();fitModel()}});
 let lastSize=[0,0,0];
 function resize(){const w=panel.clientWidth,h=panel.clientHeight,dpr=Math.min(devicePixelRatio||1,quality==='studio'?2:1);if(!w||!h||lastSize[0]===w&&lastSize[1]===h&&lastSize[2]===dpr)return;
  lastSize=[w,h,dpr];metrics.resizeCount++;cancelCamera();
  const sx=camera.view?.offsetX/(camera.view?.fullWidth||1)||0,sy=camera.view?.offsetY/(camera.view?.fullHeight||1)||0;
  renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);camera.aspect=w/h;
  if(camera.view?.enabled)camera.setViewOffset(w,h,sx*w,sy*h,w,h);else camera.updateProjectionMatrix();
 }
 window.addEventListener('resize',resize);
 const observer=new ResizeObserver(resize);observer.observe(panel);resize();
 const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');let lastTime=performance.now(),extractionProgress=0;
 function localOffset(m,cadVector){const length=cadVector.length();const inv=new THREE.Matrix4().copy(m.parent.matrixWorld).invert();return cadVector.clone().transformDirection(model.getObjectByName('world').matrixWorld).transformDirection(inv).multiplyScalar(length)}
 function animate(now){if(disposed)return;requestAnimationFrame(animate);const dt=Math.min((now-lastTime)/1000,.1);lastTime=now;if(!cameraTransition)controls.update();const openTarget=topRemoved&&!exploded&&coverLiftProgress<.001?1:0;coverProgress=reduceMotion.matches?openTarget:THREE.MathUtils.damp(coverProgress,openTarget,7,dt);if(Math.abs(coverProgress-openTarget)<.0005)coverProgress=openTarget;const liftTarget=exploded&&coverProgress<.001?1:0;coverLiftProgress=reduceMotion.matches?liftTarget:THREE.MathUtils.damp(coverLiftProgress,liftTarget,7,dt);if(Math.abs(coverLiftProgress-liftTarget)<.0005)coverLiftProgress=liftTarget;for(const p of Object.values(coverPivots)){p.object.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),p.angle*coverProgress);p.object.position.copy(p.initial).add(new THREE.Vector3(0,0,metadata.cover_animation.exploded_lift_m*coverLiftProgress))}extractionProgress=reduceMotion.matches?(extracted?1:0):THREE.MathUtils.clamp(extractionProgress+(extracted?1:-1)*dt*1.5,0,1);const alpha=reduceMotion.matches?1:1-Math.exp(-9*dt);let settled=true;scene.updateMatrixWorld(true);
 for(const m of meshes){const p=info(m.name),target=initial.get(m).clone();if(exploded){const cad=p.group_explode_offset_m?new THREE.Vector3(...p.group_explode_offset_m):assemblyVectors.get(p.assembly_id);target.add(localOffset(m,cad))}if(extracted&&m===selected&&p.extraction_enabled!==false){if(p.extraction_path_m?.length){target.add((()=>{const path=p.extraction_path_m,t=extractionProgress*(path.length-1),i=Math.min(Math.floor(t),path.length-2);return new THREE.Vector3(...path[i]).lerp(new THREE.Vector3(...path[i+1]),t-i)})())}else{const vec=new THREE.Vector3(...p.world_center_m).sub(center);if(vec.length()<.002)vec.set(0,1,0);target.add(vec.transformDirection(cadFromWorldRotation).multiplyScalar(.13))}}m.position.lerp(target,alpha);if(m.position.distanceTo(target)<1e-6)m.position.copy(target);else settled=false}
 if(pendingFit&&loaded&&Math.abs(coverProgress-openTarget)<.001&&Math.abs(coverLiftProgress-(exploded?1:0))<.001&&settled){fit();pendingFit=false}
 if(cameraTransition){const t=cameraTransition,u=THREE.MathUtils.clamp((now-t.start)/420,0,1),e=1-Math.pow(1-u,3);camera.position.lerpVectors(t.before.position,t.position,e);controls.target.lerpVectors(t.before.target,t.target,e);camera.setViewOffset(panel.clientWidth,panel.clientHeight,THREE.MathUtils.lerp(t.before.shift[0],t.shift[0],e)*panel.clientWidth,THREE.MathUtils.lerp(t.before.shift[1],t.shift[1],e)*panel.clientHeight,panel.clientWidth,panel.clientHeight);camera.lookAt(controls.target);if(u===1){cameraTransition=null;flushDamping()}}
 renderer.render(scene,camera)
 }requestAnimationFrame(animate);
}
