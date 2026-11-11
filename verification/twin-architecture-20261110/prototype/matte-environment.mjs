import {ShaderChunk} from 'three';
// Appearance experiment: retain direct PBR lighting, shadows and diffuse IBL.
// For very rough dielectrics only, approximate broad specular environment
// radiance with the diffuse environment sample. Metals/acrylic are unchanged.
export function installMatteEnvironment(scene){
 const prepared=new WeakSet(),state={materials:0,approximation:true};
 const chunk=ShaderChunk.lights_fragment_maps
  .replace('iblIrradiance += getIBLIrradiance( geometryNormal );','vec3 knightMatteEnvironment = getIBLIrradiance( geometryNormal );\niblIrradiance += knightMatteEnvironment;')
  .replace('radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );','radiance += knightMatteEnvironment / PI;');
 return {state,update(){scene.traverse(mesh=>{
  if(!mesh.isMesh)return;for(const mat of [mesh.material].flat()){
   if(prepared.has(mat)||!mat.isMeshStandardMaterial||mat.isMeshPhysicalMaterial||mat.roughness<.83||mat.metalness!==0||mat.roughnessMap||mat.metalnessMap||mat.normalMap||mat.bumpMap)continue;
   const compile=mat.onBeforeCompile,key=mat.customProgramCacheKey;
   mat.onBeforeCompile=function(shader,renderer){compile.call(this,shader,renderer);if(!shader.fragmentShader.includes('#include <lights_fragment_maps>'))throw Error('Matte experiment requires pinned standard shader');shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_maps>',chunk)};
   mat.customProgramCacheKey=function(){return key.call(this)+'|knight-matte-environment-v1'};
   mat.needsUpdate=true;prepared.add(mat);state.materials++;
  }
 })}};
}
