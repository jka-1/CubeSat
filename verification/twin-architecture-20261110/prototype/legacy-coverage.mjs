import {MeshStandardMaterial,Color,SRGBColorSpace,Vector4} from 'three';

// r176-only shader adapter. Keep the standard PBR/alpha/depth pipeline and
// reconstruct the original two-color artwork from a full-resolution R8 mask.
export class CoverageStandardMaterial extends MeshStandardMaterial {
 onBeforeCompile(shader){
  const record=this.map?.userData.coverage;if(!record)throw Error('Missing coverage metadata');
  const color=new Color().setRGB(...record.foregroundRGBA.slice(0,3).map(x=>x/255),SRGBColorSpace);
  shader.uniforms.knightCoverage={value:new Vector4(color.r,color.g,color.b,record.foregroundRGBA[3]/255)};
  if(!shader.fragmentShader.includes('#include <map_fragment>'))throw Error('Coverage shader contract changed');
  shader.fragmentShader='uniform vec4 knightCoverage;\n'+shader.fragmentShader.replace('#include <map_fragment>',`float knightMask=texture2D(map,vMapUv).r;
   diffuseColor *= vec4(knightCoverage.rgb*knightMask,knightCoverage.a*knightMask);`);
 }
 customProgramCacheKey(){return 'knight-r176-coverage-v1'}
}
