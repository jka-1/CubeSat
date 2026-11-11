import {MeshPhysicalMaterial,FramebufferTexture,Vector2,Vector3,LinearFilter} from 'three';
const states=new WeakMap();

// Deliberate appearance alternative, NOT physically equivalent transmission:
// reuse the resolved display-color buffer once; combine blurred screen color
// with the original PBR surface's reflections. No HDR target or opaque replay.
export class LeanAcrylicMaterial extends MeshPhysicalMaterial {
 constructor(){super();this.isLeanAcrylicMaterial=true}
 copy(source){super.copy(source);this.userData.leanTransmission=source.userData.leanTransmission??source.transmission;this.transmission=0;return this}
 onBeforeRender(renderer){const state=states.get(renderer);if(!state)throw Error('Acrylic capture not installed');state.capture();this._leanState=state}
 onBeforeCompile(shader){
  const state=this._leanState;if(!state)throw Error('Missing acrylic state');
  Object.assign(shader.uniforms,{knightCapture:state.map,knightCaptureSize:state.size,knightCaptureOrigin:state.origin,knightTransmission:{value:this.userData.leanTransmission}});
  for(const chunk of ['transmission_fragment','tonemapping_fragment'])if(!shader.fragmentShader.includes('#include <'+chunk+'>'))throw Error('Acrylic shader contract changed');
  shader.fragmentShader=`uniform sampler2D knightCapture;
   uniform vec2 knightCaptureSize;
   uniform vec2 knightCaptureOrigin;
   uniform float knightTransmission;
   vec3 knightScreenColor(){
    vec2 uv=(gl_FragCoord.xy-knightCaptureOrigin)/knightCaptureSize;
    vec3 sum=vec3(0.0);
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
     vec4 sampleColor=texture2D(knightCapture,uv+vec2(float(x),float(y))*2.0/knightCaptureSize);
     sum+=sRGBTransferEOTF(sampleColor).rgb;
    }
    return sum/9.0;
   }
  `+shader.fragmentShader
   .replace('#include <transmission_fragment>','totalDiffuse *= 1.0-knightTransmission;')
   .replace('#include <tonemapping_fragment>',`#include <tonemapping_fragment>
    vec3 knightF=EnvironmentBRDF(geometryNormal,geometryViewDir,material.specularColor,material.specularF90,material.roughness);
    gl_FragColor.rgb += (1.0-knightF)*diffuseColor.rgb*knightTransmission*knightScreenColor();`);
 }
 customProgramCacheKey(){return 'knight-r176-display-acrylic-v2'}
}

export function captureRegion(bounds,width,height,oldWidth=0,oldHeight=0){
 if(!bounds)return {x:0,y:0,width,height};
 const clamp=(v,hi)=>Math.max(0,Math.min(hi,v));
 const x0=clamp(Math.floor(bounds.minX)-3,width),y0=clamp(Math.floor(bounds.minY)-3,height),x1=clamp(Math.ceil(bounds.maxX)+3,width),y1=clamp(Math.ceil(bounds.maxY)+3,height);
 if(x1<=x0||y1<=y0)return {x:0,y:0,width:1,height:1,empty:true};
 const w=Math.min(width,Math.max(oldWidth,Math.ceil((x1-x0)/64)*64)),h=Math.min(height,Math.max(oldHeight,Math.ceil((y1-y0)/64)*64));
 return {x:Math.min(x0,width-w),y:Math.min(y0,height-h),width:w,height:h};
}

export function installLeanAcrylic(renderer,model){
 let used=false;model.traverse(mesh=>{if(mesh.isMesh&&[mesh.material].flat().some(m=>m.isLeanAcrylicMaterial)){mesh.renderOrder=-100;used=true}});
 if(!used)return ()=>{};
 const regionMode=new URLSearchParams(location.search).get('capture')==='region',point=new Vector3();
 let copied=false,texture=null,bounds=null,smallFrames=0;
 const state={map:{value:null},size:{value:new Vector2(1,1)},origin:{value:new Vector2()},capture(){
  if(copied)return;
  const width=renderer.domElement.width,height=renderer.domElement.height;
  const desired=captureRegion(bounds,width,height);
  if(desired.empty){copied=true;return}
  if(texture&&texture.image.width*texture.image.height>width*height*.5&&desired.width*desired.height<texture.image.width*texture.image.height*.25)smallFrames++;else smallFrames=0;
  const previous=smallFrames>=30?null:texture,region=captureRegion(bounds,width,height,previous?.image.width,previous?.image.height);
  if(!texture||texture.image.width!==region.width||texture.image.height!==region.height){
   if(texture){renderer.__prototypeCopies.delete(texture);texture.dispose()}
   texture=new FramebufferTexture(region.width,region.height);texture.minFilter=LinearFilter;texture.magFilter=LinearFilter;
   state.map.value=texture;state.size.value.set(region.width,region.height);
  }
  state.origin.value.set(region.x,region.y);renderer.copyFramebufferToTexture(texture,state.origin.value);renderer.__acrylicCopyPixels=region.width*region.height;copied=true;
 }};
 states.set(renderer,state);return camera=>{
  copied=false;bounds=null;renderer.__acrylicCopyPixels=0;if(!regionMode)return;
  const width=renderer.domElement.width,height=renderer.domElement.height;let valid=true,count=0;
  const projected={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  model.traverseVisible(mesh=>{
   if(!mesh.isMesh||![mesh.material].flat().some(m=>m.isLeanAcrylicMaterial))return;
   if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;
   for(let i=0;i<8;i++){
    point.set(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    if(-point.z<=camera.near){valid=false;continue}point.applyMatrix4(camera.projectionMatrix);
    const x=(point.x*.5+.5)*width,y=(point.y*.5+.5)*height;
    projected.minX=Math.min(projected.minX,x);projected.maxX=Math.max(projected.maxX,x);projected.minY=Math.min(projected.minY,y);projected.maxY=Math.max(projected.maxY,y);count++;
   }
  });
  if(valid&&count)bounds=projected;
 };
}
