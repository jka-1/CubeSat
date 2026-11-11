import {Group,Mesh,InstancedMesh,FrontSide,DoubleSide} from 'three';
import {createDepthGuard,conditionalDepthMaterial} from './depth-guard.mjs';
import {installCertifiedCulling} from './certified-culling.mjs';
import {installOrthographicShadows} from './orthographic-shadow.mjs';
import {installCheapOcclusion} from './cheap-occlusion.mjs';
import {installLeanAcrylic} from './lean-acrylic.mjs';
import {installFXAA} from './fxaa-pass.mjs';

// The measured path only: no renderer experiments, test clocks or quality
// query parameters. All passes are inside render(), including the final AA.
export function createRenderPipeline(renderer,scene,camera,model){
 renderer.__renderCopies=new Map();
 const copy=renderer.copyFramebufferToTexture.bind(renderer);
 renderer.copyFramebufferToTexture=(texture,...args)=>{copy(texture,...args);renderer.__renderCopies.set(texture,{width:texture.image.width,height:texture.image.height})};
 const acrylic=installLeanAcrylic(renderer,model),guard=createDepthGuard(scene,camera,{conditional:true});
 const culling=installCertifiedCulling(scene),shadow=installOrthographicShadows(scene);
 const occlusion=installCheapOcclusion(renderer,scene),fxaa=installFXAA(renderer);
 const warmMaterials=new Set(),shadowModes=new WeakMap();let released=false,warmMs=0;
 const draw=renderer.render.bind(renderer);
 function prepare(){
  guard.update();culling.update(camera);acrylic(camera);
  scene.traverseVisible(mesh=>{if(mesh.isMesh)for(const mat of [mesh.material].flat()){
   // r176 does not automatically invalidate a cached program when only
   // shadowMap.enabled changes. Include cached overrides on their next use.
   if(shadowModes.get(mat)!==renderer.shadowMap.enabled){mat.needsUpdate=true;shadowModes.set(mat,renderer.shadowMap.enabled)}
   occlusion.prepareMaterial(mat);
  }});
 }
 return {
  guard,culling,shadow,occlusion,fxaa,
  state:()=>({depth:guard.state,closedSolids:{...culling.state},antialiasing:'fxaa',acrylic:'display-space',warmMs,captureTextures:renderer.__renderCopies.size,warmMaterials:warmMaterials.size}),
  render(){if(released)return;prepare();occlusion.render(camera,guard,draw);fxaa.render(draw)},
  warmBindings(){
   // compileAsync links programs; uniform/vertex bindings can still be lazy.
   // Exercise the real materials before interaction, then restore them exactly.
   const originals=new Map(),clones=new Map(),closed=new Set();
   scene.traverseVisible(mesh=>{if(!mesh.isMesh)return;
    originals.set(mesh,mesh.material);
    const convert=source=>{
     if(!clones.has(source)){
      const material=source.clone();conditionalDepthMaterial(material);occlusion.prepareMaterial(material);
      material.defines??={};delete material.defines.KNIGHT_BOUNDED_DEPTH;clones.set(source,material);
     }
     const material=clones.get(source);if(mesh.userData.certifiedClosed&&!material.transparent)closed.add(material);
     return material;
    };
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(convert):convert(mesh.material);
   });
   const refresh=renderer.shadowMap.needsUpdate;renderer.shadowMap.needsUpdate=false;
   try{
    acrylic(camera);draw(scene,camera);
    for(const material of closed){material.side=DoubleSide;material.needsUpdate=true}
    acrylic(camera);draw(scene,camera);
   }finally{
    for(const [mesh,material] of originals)mesh.material=material;
    for(const material of clones.values())material.dispose();
    renderer.shadowMap.needsUpdate=refresh;
   }
  },
  async warm(cancelled=()=>false){
   const start=performance.now();prepare();
   await renderer.compileAsync(scene,camera);
   if(cancelled())return;
   // Compile the near-camera depth/sidedness and transparent override programs
   // against the same lights/environment. Keep their references until disposal
   // so the renderer does not release them before the first interaction.
   const group=new Group();
   scene.traverse(mesh=>{
    if(!mesh.isMesh)return;
    for(const source of [mesh.material].flat())for(const bounded of [true,false])for(const side of [FrontSide,DoubleSide])for(const transparent of new Set([source.transparent,true])){
     const material=source.clone();material.side=side;material.transparent=transparent;
     conditionalDepthMaterial(material);occlusion.prepareMaterial(material);material.defines??={};
     if(bounded)material.defines.KNIGHT_BOUNDED_DEPTH=1;else delete material.defines.KNIGHT_BOUNDED_DEPTH;
     const proxy=mesh.isInstancedMesh?new InstancedMesh(mesh.geometry,material,mesh.count):new Mesh(mesh.geometry,material);
     proxy.receiveShadow=mesh.receiveShadow;group.add(proxy);warmMaterials.add(material);
    }
   });
   const shadows=renderer.shadowMap.enabled;
   try{
    renderer.shadowMap.enabled=true;await renderer.compileAsync(group,camera,scene);
    if(!cancelled()){renderer.shadowMap.enabled=false;await renderer.compileAsync(group,camera,scene)}
    if(!cancelled())await fxaa.warm();
   }finally{renderer.shadowMap.enabled=shadows;group.traverse(mesh=>{if(mesh.isInstancedMesh)mesh.dispose()});group.clear();warmMs=performance.now()-start}
  },
  dispose(){
   if(released)return;released=true;
   acrylic.dispose?.();fxaa.dispose();occlusion.dispose();
   for(const material of warmMaterials)material.dispose();warmMaterials.clear();
   for(const [texture] of renderer.__renderCopies)texture.dispose();renderer.__renderCopies.clear();
  }
 };
}
