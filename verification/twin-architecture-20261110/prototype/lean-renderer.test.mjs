import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return next(specifier==='three'?new URL('./vendor/three-r176/three.module.js',import.meta.url).href:specifier,context)}});
const {depthRange,conditionalDepthMaterial}=await import('./depth-guard.mjs');
const {CoverageStandardMaterial}=await import('./legacy-coverage.mjs');
const {LeanAcrylicMaterial,captureRegion}=await import('./lean-acrylic.mjs');
const {installOrthographicShadows}=await import('./orthographic-shadow.mjs');
import {MeshStandardMaterial,MeshPhysicalMaterial,DataTexture,RedFormat,UnsignedByteType,ShaderLib} from './vendor/three-r176/three.module.js';

test('depth fit covers the assembly and exposes unsafe camera intersections',()=>{
 for(const [near,far] of [[.001,.3],[.1,1],[4,6]]){
  const r=depthRange(near,far);assert.ok(r.near<=near&&r.far>=far);assert.ok(r.certified);
  const depth=z=>(1/z-1/r.far)/(1/r.near-1/r.far);
  // All source artwork planes are at least 64.999 micrometres apart.
  assert.ok(Math.abs(depth(far)-depth(far-.000064))*(2**24-1)>8);
 }
 assert.equal(depthRange(-.1,1).certified,false);
 assert.equal(depthRange(.01,15).certified,false);
});
test('coverage material clones retain shader behavior through viewer overrides',()=>{
 const source=new MeshStandardMaterial(),map=new DataTexture(new Uint8Array([0,255]),2,1,RedFormat,UnsignedByteType);
 map.userData.coverage={foregroundRGBA:[17,88,23,205]};source.map=map;
 const material=new CoverageStandardMaterial().copy(source),clone=material.clone();
 const shader={fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}};clone.onBeforeCompile(shader);
 assert.equal(clone.map,map);assert.ok(shader.fragmentShader.includes('knightCoverage.rgb*knightMask'));
 assert.equal(shader.uniforms.knightCoverage.value.w,205/255);
 assert.throws(()=>clone.onBeforeCompile({fragmentShader:'wrong version',uniforms:{}}),/contract/);
});
test('acrylic clones retain physical surface parameters and explicit alternative transmission',()=>{
 const source=new MeshPhysicalMaterial({transmission:.85,opacity:.25,roughness:.19,ior:1.46,transparent:true});
 const material=new LeanAcrylicMaterial().copy(source),clone=material.clone();
 assert.equal(clone.transmission,0);assert.equal(clone.userData.leanTransmission,.85);
 for(const key of ['roughness','ior','opacity','transparent'])assert.equal(clone[key],source[key]);
 assert.ok(clone.isLeanAcrylicMaterial);
});
test('bounded depth wraps existing shader hooks and retains the log fallback',()=>{
 const mat=new MeshStandardMaterial();mat.onBeforeCompile=shader=>{shader.uniforms.existing={value:1}};
 conditionalDepthMaterial(mat);
 const shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}};
 mat.onBeforeCompile(shader);assert.equal(shader.uniforms.existing.value,1);
 for(const source of [shader.vertexShader,shader.fragmentShader])assert.ok(source.startsWith('#ifdef KNIGHT_BOUNDED_DEPTH\n#undef USE_LOGDEPTHBUF\n#endif\n'));
 assert.ok(shader.fragmentShader.includes('#include <logdepthbuf_fragment>'));
});
test('orthographic shadow optimization preserves the packed depth formula and resets for perspective lights',()=>{
 const material=new MeshStandardMaterial(),mesh={isMesh:true,onBeforeShadow(){}};
 installOrthographicShadows({traverse(callback){callback(mesh)}});
 mesh.onBeforeShadow(null,null,null,{isOrthographicCamera:true},null,material,null);
 const shader={vertexShader:ShaderLib.depth.vertexShader,fragmentShader:ShaderLib.depth.fragmentShader,uniforms:{}};
 material.onBeforeCompile(shader);
 assert.equal(material.defines.KNIGHT_ORTHO_SHADOW,1);
 assert.ok(shader.fragmentShader.includes('float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;'));
 mesh.onBeforeShadow(null,null,null,{isOrthographicCamera:false},null,material,null);
 assert.ok(!('KNIGHT_ORTHO_SHADOW' in material.defines));
});

const {partitionClosed}=await import('./partition-closed.mjs');
const {installCertifiedCulling}=await import('./certified-culling.mjs');
const T=await import('./vendor/three-r176/three.module.js');
test('closed-face partition retains every source triangle and attribute without copying vertices',()=>{
 const source=new T.BoxGeometry().toNonIndexed();source.clearGroups();const count=source.attributes.position.count;
 const out=partitionClosed(source,[[0,6],[12,6]]);
 assert.equal(out.attributes.position,source.attributes.position);assert.equal(out.attributes.normal,source.attributes.normal);assert.equal(out.attributes.uv,source.attributes.uv);
 assert.equal(out.index.count,count);assert.equal(out.groups[0].count,12);
 const triangles=geometry=>{const ids=geometry.index?.array||Array.from({length:geometry.attributes.position.count},(_,i)=>i);return Array.from({length:ids.length/3},(_,i)=>[ids[i*3],ids[i*3+1],ids[i*3+2]].join('/')).sort()};
 assert.deepEqual(triangles(out),triangles(source));assert.equal(partitionClosed(source,[[0,6],[12,6]]),out);
 assert.throws(()=>partitionClosed(new T.BufferGeometry().copy(source),[[0,4]]),/Invalid/);
});
test('closed solids retain both sides for clipped/interior views and transparent overrides',()=>{
 const scene=new T.Scene(),material=new T.MeshStandardMaterial({side:T.DoubleSide}),mesh=new T.Mesh(new T.BoxGeometry(),material);mesh.userData.certifiedClosed=true;scene.add(mesh);
 const light=new T.DirectionalLight();light.position.set(4,6,4);light.castShadow=true;light.shadow.camera.near=.1;light.shadow.camera.far=20;scene.add(light);
 const camera=new T.PerspectiveCamera(40,1,.1,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);scene.updateMatrixWorld(true);camera.updateMatrixWorld();const culling=installCertifiedCulling(scene);culling.update(camera);
 assert.equal(material.side,T.FrontSide);assert.equal(material.shadowSide,T.FrontSide);
 camera.position.set(0,0,0);camera.lookAt(0,0,-1);camera.updateMatrixWorld();culling.update(camera);assert.equal(material.side,T.DoubleSide);
 camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.near=5;camera.updateMatrixWorld();culling.update(camera);assert.equal(material.side,T.DoubleSide);
 camera.near=.1;material.transparent=true;culling.update(camera);assert.equal(material.side,T.DoubleSide);assert.equal(material.shadowSide,T.DoubleSide);
});

const {installMaterialConstants}=await import('./material-constants.mjs');
test('fixed material programs preserve uniform Float32 values and isolate distinct finishes',()=>{
 const scene=new T.Scene(),a=new T.MeshStandardMaterial({roughness:.62,metalness:.03}),b=new T.MeshStandardMaterial({roughness:.9,metalness:0});scene.add(new T.Mesh(new T.BoxGeometry(),a),new T.Mesh(new T.BoxGeometry(),b));const constants=installMaterialConstants(scene);constants.update();
 assert.notEqual(a.customProgramCacheKey(),b.customProgramCacheKey());
 const shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}};a.onBeforeCompile(shader);
 for(const name of ['roughness','metalness']){const value=Number(shader.fragmentShader.match(new RegExp('const float '+name+' = ([^;]+);'))[1]);assert.equal(Math.fround(value),Math.fround(a[name]))}
 const key=a.customProgramCacheKey(),version=a.version;a.roughness=.8;constants.update();assert.notEqual(a.customProgramCacheKey(),key);assert.ok(a.version>version);
});

test('regional capture retains original pixels and all blur taps, including screen edges and resize',()=>{
 for(const [width,height] of [[1910,1440],[300,200],[1,1]])for(const bounds of [{minX:35.2,minY:40.8,maxX:120.4,maxY:140.1},{minX:-10,minY:-5,maxX:width+10,maxY:height+5},{minX:width-7,minY:height-8,maxX:width,maxY:height}]){
  const r=captureRegion(bounds,width,height,192,256);assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=width&&r.y+r.height<=height);
  assert.ok(r.x<=Math.max(0,Math.floor(bounds.minX)-3)&&r.y<=Math.max(0,Math.floor(bounds.minY)-3));
  assert.ok(r.x+r.width>=Math.min(width,Math.ceil(bounds.maxX)+3)&&r.y+r.height>=Math.min(height,Math.ceil(bounds.maxY)+3));
 }
 assert.deepEqual(captureRegion(null,1910,1440),{x:0,y:0,width:1910,height:1440});
});

const {cheapOccluder}=await import('./cheap-occlusion.mjs');
test('occlusion prepass rejects surfaces that cannot safely write ordinary opaque depth',()=>{
 const material=new T.MeshStandardMaterial(),mesh=new T.Mesh(new T.BoxGeometry(),material);assert.ok(cheapOccluder(mesh));
 for(const [name,value] of [['transparent',true],['depthWrite',false],['depthTest',false],['alphaTest',.1],['alphaHash',true],['alphaToCoverage',true],['polygonOffset',true]]){const previous=material[name];material[name]=value;assert.ok(!cheapOccluder(mesh),name);material[name]=previous}
 mesh.material=[material];assert.ok(!cheapOccluder(mesh));
});

test('fully offscreen acrylic avoids a framebuffer copy; uncertain projection retains full capture',()=>{
 assert.equal(captureRegion({minX:-100,minY:40,maxX:-10,maxY:80},1910,1440).empty,true);
 assert.equal(captureRegion({minX:2000,minY:40,maxX:2100,maxY:80},1910,1440).empty,true);
 assert.equal(captureRegion(null,1910,1440).width,1910);
});

test('R8 artwork shadow alpha is corrected independently of orthographic depth optimization',()=>{
 const material=new T.MeshDepthMaterial({alphaTest:.1}),map=new T.DataTexture(new Uint8Array([0,255]),2,1,T.RedFormat);map.userData.coverage={foregroundRGBA:[255,255,255,255]};material.map=map;
 const mesh={isMesh:true,onBeforeShadow(){}};installOrthographicShadows({traverse(fn){fn(mesh)}},{omitOrthographicDepthWrite:false});mesh.onBeforeShadow(null,null,null,{isOrthographicCamera:true},null,material,null);
 assert.equal(material.defines.KNIGHT_COVERAGE_SHADOW_ALPHA,1);assert.ok(!('KNIGHT_ORTHO_SHADOW' in material.defines));
 const shader={vertexShader:ShaderLib.depth.vertexShader,fragmentShader:ShaderLib.depth.fragmentShader,uniforms:{}};material.onBeforeCompile(shader);assert.ok(shader.fragmentShader.includes('texture2D(map,vMapUv).r * float(KNIGHT_COVERAGE_SHADOW_ALPHA)'));
});
