import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {CoverageStandardMaterial} from './legacy-coverage.mjs';
import {LeanAcrylicMaterial} from './lean-acrylic.mjs';
import {partitionClosed} from './partition-closed.mjs';
const asset=new URLSearchParams(location.search).get('asset')||'original';
const cull=new URLSearchParams(location.search).get('cull');
if(!['original','compiled','packed','surface','compact'].includes(asset))throw Error('Unknown display package');
let maskInfo=null,maskBytes=null,layout=null;
export async function loadModel(original){
 const loader=new GLTFLoader();
 if(['packed','surface','compact'].includes(asset)){
  [maskInfo,maskBytes,layout]=await Promise.all([fetch('./assets/artwork-masks.json').then(r=>r.json()),fetch('./assets/artwork-masks.bin.gz').then(r=>new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()),fetch('./assets/artwork-layout.json').then(r=>r.json())]);
  loader.register(parser=>({name:'KNIGHT_COVERAGE_TEXTURE',loadTexture(index){
   const record=maskInfo.records.find(r=>r.textures.includes(index));if(!record)return null;
   const [w,h]=record.dimensions,data=new Uint8Array(maskBytes,record.offset,record.length),texture=new THREE.DataTexture(data,w,h,THREE.RedFormat,THREE.UnsignedByteType);
   texture.name='Coverage_'+record.image;texture.flipY=false;texture.unpackAlignment=1;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.userData.coverage=record;texture.needsUpdate=true;return Promise.resolve(texture);
  }}));
 }
 const url=asset==='compact'?new URL('./assets/display-compact.glb',import.meta.url).href:['compiled','packed','surface'].includes(asset)?new URL('./assets/display.glb',import.meta.url).href:original;
 let gltf;
 if(['certified','partial'].includes(cull)){
  if(asset==='original')throw Error('Closed-solid certification requires the exact prepared asset');
  const [bytes,certificate]=await Promise.all([fetch(url).then(r=>r.arrayBuffer()),fetch(asset==='compact'?'./assets/closed-primitives-compact.json':'./assets/closed-primitives.json').then(r=>r.json())]);
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==certificate.displaySHA256)throw Error('Closed-solid certificate does not match geometry');
  gltf=await loader.parseAsync(bytes,url.slice(0,url.lastIndexOf('/')+1));
  const rows=new Map(certificate.primitives.map(p=>[p.mesh+'/'+p.primitive,p]));
  gltf.scene.traverse(mesh=>{const a=gltf.parser.associations.get(mesh),row=a&&rows.get(a.meshes+'/'+a.primitives);if(!mesh.isMesh||!row)return;if(row.eligible)mesh.userData.certifiedClosed=true;else if(cull==='partial'&&row.closedTriangles>0){mesh.userData.certifiedClosed=true;mesh.userData.certifiedClosedRanges=row.closedRanges}});
 }else gltf=await loader.loadAsync(url);
 maskBytes=null;return gltf;
}
function standard(source){return new THREE.MeshStandardNodeMaterial({name:source.name,roughness:source.roughness,metalness:source.metalness,color:source.color.clone(),emissive:source.emissive.clone(),emissiveIntensity:source.emissiveIntensity,transparent:source.transparent,opacity:source.opacity,alphaTest:source.alphaTest,side:source.side,depthWrite:source.depthWrite,depthTest:source.depthTest,toneMapped:source.toneMapped})}
function coverageMaterial(source){
 if(!THREE.TSL){source.map.colorSpace=THREE.NoColorSpace;return new CoverageStandardMaterial().copy(source)}
 const {texture,vec3}=THREE.TSL,record=source.map.userData.coverage,t=source.map;t.colorSpace=THREE.NoColorSpace;
 const color=new THREE.Color().setRGB(...record.foregroundRGBA.slice(0,3).map(x=>x/255),THREE.SRGBColorSpace),sample=texture(t).r,material=standard(source);
 material.colorNode=sample.mul(vec3(color.r,color.g,color.b));material.opacityNode=sample.mul(record.foregroundRGBA[3]/255);material.map=t;return material;
}
function uvAt(layer){
 const axes=[0,1,2].filter(k=>layer.positions.some(p=>Math.abs(p[k]-layer.positions[0][k])>1e-7));if(axes.length!==2)throw Error('Artwork plane not planar');
 const [a,b]=axes,rows=[];
 for(let i=0;i<layer.positions.length&&rows.length<3;i++){const p=layer.positions[i];if(rows.some(r=>r.p[a]===p[a]&&r.p[b]===p[b]))continue;rows.push({p,uv:layer.uv[i]})}
 const matrix=new THREE.Matrix3().set(...rows.flatMap(r=>[r.p[a],r.p[b],1])).invert();
 const u=new THREE.Vector3(...rows.map(r=>r.uv[0])).applyMatrix3(matrix),v=new THREE.Vector3(...rows.map(r=>r.uv[1])).applyMatrix3(matrix);
 const pos=THREE.TSL.positionLocal,keys=['x','y','z'];return THREE.TSL.vec2(pos[keys[a]].mul(u.x).add(pos[keys[b]].mul(u.y)).add(u.z),pos[keys[a]].mul(v.x).add(pos[keys[b]].mul(v.y)).add(v.z));
}
export function prepareModel(model){
 model.traverse(m=>{if(m.userData.framingPoints)m.userData.framingPoints=m.userData.framingPoints.map(v=>Array.isArray(v)?new THREE.Vector3(...v):v)});
 model.traverse(m=>{if(!m.isMesh||!m.userData.certifiedClosed)return;
  if(m.userData.certifiedClosedRanges){if(Array.isArray(m.material))throw Error('Unexpected multi-material primitive');m.geometry=partitionClosed(m.geometry,m.userData.certifiedClosedRanges);m.material=[m.material.clone(),m.material];m.userData.certifiedClosedMaterialIndices=[0]}
  else m.material=Array.isArray(m.material)?m.material.map(mat=>mat.clone()):m.material.clone();
 });
 if(!maskInfo)return;
 const cache=new Map();model.traverse(m=>{if(!m.isMesh)return;const convert=mat=>{if(!mat.map?.userData.coverage)return mat;if(!cache.has(mat))cache.set(mat,coverageMaterial(mat));return cache.get(mat)};m.material=Array.isArray(m.material)?m.material.map(convert):convert(m.material)});
 window.__artworkPreparation={asset,coverageMaterials:cache.size,surfaceMaterials:0,hiddenCarriers:0};
 if(asset==='surface'){
  const {texture,vec3,mix,positionLocal,normalLocal,float}=THREE.TSL;
  for(const cfg of layout){
   const part=model.getObjectByName(cfg.id),maps={};part.traverse(m=>{if(m.isMesh)for(const mat of [m.material].flat())for(const [key,layer] of Object.entries(cfg.layers))if(mat.name===layer.materialName)maps[key]=mat.map});
   if(Object.keys(maps).length!==3)throw Error('Missing artwork maps '+cfg.id);
   const axis=[0,1,2].find(k=>cfg.layers.top.positions.every(p=>p[k]===cfg.layers.top.positions[0][k])),key=['x','y','z'][axis];
   const candidates=[];part.traverse(m=>{if(m.isMesh)candidates.push(m)});
   for(const mesh of candidates){
    mesh.material=[mesh.material].flat().map(source=>{
     const substrate=cfg.substrates.find(s=>s.materialName===source.name||source.color.equals(new THREE.Color(...[0.1843137254901961,0.15294117647058825,0.058823529411764705])));
     if(!substrate||source.map)return source;
     window.__artworkPreparation.surfaceMaterials++;const material=standard(source);let color=vec3(source.color.r,source.color.g,source.color.b),rough=float(source.roughness);
     for(const face of ['top','bottom']){
      const layer=cfg.layers[face],target=layer.positions[0][axis],plane=Math.abs(substrate.min[axis]-target)<Math.abs(substrate.max[axis]-target)?substrate.min[axis]:substrate.max[axis];
      const onFace=positionLocal[key].sub(plane).abs().lessThan(1e-6).and(normalLocal[key].abs().greaterThan(.99));
      const sample=texture(maps[face],uvAt(layer)).r,rgba=maps[face].userData.coverage.foregroundRGBA,fore=new THREE.Color().setRGB(...rgba.slice(0,3).map(x=>x/255),THREE.SRGBColorSpace),alpha=sample.mul(rgba[3]/255);
      const composite=mix(color,sample.mul(vec3(fore.r,fore.g,fore.b)),alpha);color=mix(color,composite,onFace);rough=mix(rough,float(.9),onFace.and(sample.greaterThan(0)));
      if(face==='top'){const silk=texture(maps.silk,uvAt(cfg.layers.silk)).r,ink=onFace.and(silk.greaterThan(.1));color=mix(color,vec3(silk),ink);rough=mix(rough,float(.9),ink)}
     }
     material.colorNode=color;material.roughnessNode=rough;material.artworkTopMap=maps.top;material.artworkBottomMap=maps.bottom;material.artworkSilkMap=maps.silk;return material;
    });if(mesh.material.length===1)mesh.material=mesh.material[0];
   }
   // Keep canonical carrier geometry for ownership/integrity/picking; this
   // explicitly approved rendering experiment suppresses its separate draws.
   part.traverse(m=>{if(m.isMesh&&[m.material].flat().some(mat=>Object.values(cfg.layers).some(l=>l.materialName===mat.name))){m.visible=false;m.userData.auxiliaryArtworkCarrier=true;window.__artworkPreparation.hiddenCarriers++}});
  }
 }
}

export function applyCostDiagnostic(model){
 const appearance=new URLSearchParams(location.search).get('appearance');
 if(appearance==='lean-acrylic'){
  if(THREE.TSL)throw Error('Display acrylic experiment requires the legacy renderer');
  const cache=new Map();model.traverse(mesh=>{if(mesh.isMesh){const convert=source=>{if(!(source.transmission>0))return source;if(!cache.has(source))cache.set(source,new LeanAcrylicMaterial().copy(source));return cache.get(source)};mesh.material=Array.isArray(mesh.material)?mesh.material.map(convert):convert(mesh.material)}});
  diagnosticBadge('DISPLAY-SPACE ACRYLIC ALTERNATIVE');
  window.__costDiagnostic={eligibleStudio:false,changes:['Display-space blurred acrylic replaces HDR physical transmission','One opaque-buffer capture; no opaque replay'],retained:['Opaque PBR materials','Original acrylic surface PBR reflections','Full drawing buffer','All source triangles','Four-sample antialiasing','Original artwork layers','Cached shadows']};return;
 }
 if(appearance==='opaque-pbr'){
  const changed=new Set();model.traverse(mesh=>{if(mesh.isMesh)for(const mat of [mesh.material].flat())if(mat.transmission>0){mat.transmission=0;mat.needsUpdate=true;changed.add(mat)}});
  diagnosticBadge('PBR · REFRACTION DISABLED');
  window.__costDiagnostic={eligibleStudio:false,changes:['Acrylic transmission disabled'],retained:['Original opaque PBR materials','Full drawing buffer','All source triangles','Logarithmic depth','Four-sample antialiasing','Cached shadows'],changedMaterials:changed.size};return;
 }
 if(appearance!=='cost-floor')return;
 const cache=new Map();model.traverse(mesh=>{if(!mesh.isMesh)return;const convert=source=>{if(cache.has(source))return cache.get(source);const Basic=THREE.MeshBasicNodeMaterial||THREE.MeshBasicMaterial;const mat=new Basic({name:source.name+' / DIAGNOSTIC UNLIT',color:source.color.clone(),map:source.map,transparent:source.transparent,opacity:source.opacity,alphaTest:source.alphaTest,side:source.side,depthWrite:source.depthWrite,depthTest:source.depthTest});if(source.colorNode)mat.colorNode=source.colorNode;if(source.opacityNode)mat.opacityNode=source.opacityNode;cache.set(source,mat);return mat};mesh.material=Array.isArray(mesh.material)?mesh.material.map(convert):convert(mesh.material)});
 diagnosticBadge('UNLIT MATERIALS');
 window.__costDiagnostic={eligibleStudio:false,changes:['Unlit CAD materials','Acrylic refraction replaced by tinted alpha','Environment shading omitted'],retained:['Full drawing buffer','All source triangles','Logarithmic depth','Four-sample antialiasing','Original artwork coverage']};
}
function diagnosticBadge(label){const badge=document.createElement('div');badge.dataset.architectureDiagnostic='';badge.textContent='DIAGNOSTIC · '+label+(new URLSearchParams(location.search).get('pbr')==='matte-env'?' · MATTE ENVIRONMENT APPROXIMATION':'')+(new URLSearchParams(location.search).get('aa')==='off'?' · ADDITIONAL MSAA OFF':new URLSearchParams(location.search).get('aa')==='fxaa'?' · FXAA / ADDITIONAL MSAA OFF':'')+' · NOT STUDIO QUALITY';badge.style.cssText='position:fixed;left:16px;bottom:75px;z-index:99;background:#522;color:white;padding:8px;font:12px monospace;pointer-events:none';document.body.append(badge)}
