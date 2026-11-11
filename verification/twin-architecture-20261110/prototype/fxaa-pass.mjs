import {Scene,Camera,Mesh,PlaneGeometry,ShaderMaterial,FramebufferTexture,LinearFilter,NoBlending,Vector2} from 'three';
import {FXAAShader} from './vendor/FXAAShader.mjs';

// Explicit quality alternative: full DPR 2 with pinned r176 FXAA instead of
// default-framebuffer MSAA. Input already contains ACES/sRGB output; the raw
// FXAA shader performs no second tone mapping or color-space conversion.
export function installFXAA(renderer){
 const scene=new Scene(),camera=new Camera(),geometry=new PlaneGeometry(2,2),material=new ShaderMaterial({name:'Knight r176 FXAA',vertexShader:FXAAShader.vertexShader,fragmentShader:FXAAShader.fragmentShader,uniforms:{tDiffuse:{value:null},resolution:{value:new Vector2()}},depthTest:false,depthWrite:false,toneMapped:false,blending:NoBlending});
 const quad=new Mesh(geometry,material);quad.frustumCulled=false;scene.add(quad);let texture=null;
 const state={enabled:true,width:0,height:0};
 return {state,render(draw){
  const width=renderer.domElement.width,height=renderer.domElement.height;
  if(!texture||texture.image.width!==width||texture.image.height!==height){
   if(texture){renderer.__prototypeCopies.delete(texture);texture.dispose()}
   texture=new FramebufferTexture(width,height);texture.minFilter=LinearFilter;texture.magFilter=LinearFilter;
   material.uniforms.tDiffuse.value=texture;material.uniforms.resolution.value.set(1/width,1/height);state.width=width;state.height=height;
  }
  renderer.copyFramebufferToTexture(texture);const clear=renderer.autoClear;renderer.autoClear=false;
  try{draw(scene,camera)}finally{renderer.autoClear=clear}
 },dispose(){if(texture){renderer.__prototypeCopies.delete(texture);texture.dispose()}material.dispose();geometry.dispose();scene.clear()}};
}
