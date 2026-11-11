// r176's log-depth fragment writes gl_FragCoord.z unchanged for an orthographic
// camera. Omitting that write preserves depth while allowing early depth tests.
// Perspective/point-light shadows retain the engine's existing path.
export function installOrthographicShadows(scene,{omitOrthographicDepthWrite=true}={}){
 const prepared=new WeakSet(),state={orthographicDraws:0,materials:0,omitOrthographicDepthWrite,coverageAlphaFixed:true};
 scene.traverse(mesh=>{
  if(!mesh.isMesh)return;const before=mesh.onBeforeShadow;
  mesh.onBeforeShadow=function(renderer,scene,camera,shadowCamera,geometry,material,group){
   before.call(this,renderer,scene,camera,shadowCamera,geometry,material,group);
   const omit=omitOrthographicDepthWrite&&shadowCamera.isOrthographicCamera;
   const alpha=material.map?.userData.coverage&&material.alphaTest>0?material.map.userData.coverage.foregroundRGBA[3]/255:null;
   if(!omit&&alpha===null&&!prepared.has(material))return;
   if(shadowCamera.isOrthographicCamera)state.orthographicDraws++;
   if(!prepared.has(material)){
    const compile=material.onBeforeCompile;
    material.onBeforeCompile=function(shader,renderer){
     compile.call(this,shader,renderer);
     const prelude='#ifdef KNIGHT_ORTHO_SHADOW\n#undef USE_LOGDEPTHBUF\n#endif\n';
     shader.vertexShader=prelude+shader.vertexShader;shader.fragmentShader=prelude+shader.fragmentShader;
     shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      #ifdef KNIGHT_COVERAGE_SHADOW_ALPHA
       diffuseColor.a = texture2D(map,vMapUv).r * float(KNIGHT_COVERAGE_SHADOW_ALPHA);
      #endif`);
    };
    prepared.add(material);state.materials++;material.needsUpdate=true;
   }
   material.defines??={};
   if(material.defines.KNIGHT_ORTHO_SHADOW!==(omit?1:undefined)||material.defines.KNIGHT_COVERAGE_SHADOW_ALPHA!==(alpha??undefined)){
    if(omit)material.defines.KNIGHT_ORTHO_SHADOW=1;else delete material.defines.KNIGHT_ORTHO_SHADOW;
    if(alpha!==null)material.defines.KNIGHT_COVERAGE_SHADOW_ALPHA=alpha;else delete material.defines.KNIGHT_COVERAGE_SHADOW_ALPHA;
    material.needsUpdate=true;
   }
  };
 });
 return state;
}
