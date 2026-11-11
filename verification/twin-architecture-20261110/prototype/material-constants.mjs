const literal=value=>Math.fround(value).toPrecision(9);
// Fixed CAD roughness/metalness, encoded at the same Float32 precision as the
// original uniforms. This permits constant folding without a shading change.
export function installMaterialConstants(scene){
 const prepared=new WeakSet(),signatures=new WeakMap(),state={materials:0};
 return {state,update(){scene.traverse(mesh=>{
  if(!mesh.isMesh)return;
  for(const mat of [mesh.material].flat()){
   if(!mat.isMeshStandardMaterial||mat.isMeshPhysicalMaterial||mat.roughnessMap||mat.metalnessMap)continue;
   if(!prepared.has(mat)){
    const compile=mat.onBeforeCompile,key=mat.customProgramCacheKey;
    mat.onBeforeCompile=function(shader,renderer){
     compile.call(this,shader,renderer);
     for(const property of ['roughness','metalness']){
      const uniform='uniform float '+property+';';if(!shader.fragmentShader.includes(uniform))throw Error('Material constants require pinned r176 standard shader');
      shader.fragmentShader=shader.fragmentShader.replace(uniform,'const float '+property+' = '+literal(this[property])+';');
     }
    };
    mat.customProgramCacheKey=function(){return key.call(this)+'|fixed:'+literal(this.roughness)+'/'+literal(this.metalness)};
    prepared.add(mat);state.materials++;mat.needsUpdate=true;
   }
   const signature=literal(mat.roughness)+'/'+literal(mat.metalness);
   if(signatures.get(mat)!==signature){signatures.set(mat,signature);mat.needsUpdate=true}
  }
 })}};
}
