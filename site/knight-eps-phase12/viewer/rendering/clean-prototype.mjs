import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const asset=new URL('../../models/clean-prototype/appearance.glb',import.meta.url);
const finishes=['Chassis_Body_A','Chassis_Body_B','RemovableTop_Front_A','RemovableTop_Front_B','WingArm_01','WingArm_02','WingArm_03','WingArm_04'];
const panels=['SolarPanel_01','SolarPanel_02'];

export function loadCleanPrototype(){return new GLTFLoader().loadAsync(asset.href)}

// Retain CAD owners, local transforms and animation pivots. Only the solar
// panels need the supplied UVs and per-face laminate/backing material groups.
export function applyCleanPrototype(model,appearance){
 const usedGeometry=new Set(),replacedGeometry=new Set();
 for(const id of [...finishes,...panels]){
  const target=model.getObjectByName(id),source=appearance.getObjectByName('Clean_'+id);
  if(!target?.isMesh||!source)throw Error('Clean prototype component missing: '+id);
  const leaves=[];source.traverse(mesh=>{if(mesh.isMesh)leaves.push(mesh)});
  if(!leaves.length)throw Error('Clean prototype has no surface: '+id);
  if(finishes.includes(id)){
   target.material=leaves[0].material;
  }else{
   // GLTFLoader splits the three panel finishes into sibling primitives.
   // Their geometry is already in the panel's original local coordinate frame.
   const geometries=leaves.map(mesh=>mesh.geometry);
   const geometry=geometries.length===1?geometries[0]:mergeGeometries(geometries,true);
   if(!geometry)throw Error('Incompatible clean panel surfaces: '+id);
   const before=(target.geometry.index?.count||target.geometry.attributes.position.count)/3;
   const after=(geometry.index?.count||geometry.attributes.position.count)/3;
   if(before!==after)throw Error('Clean panel triangle count changed: '+id);
   replacedGeometry.add(target.geometry);
   target.geometry=geometry;target.material=leaves.length===1?leaves[0].material:leaves.map(mesh=>mesh.material);
   usedGeometry.add(geometry);
   // The existing certificate covers the original buffer, not these UV seams.
   delete target.userData.certifiedClosed;
  }
  for(const material of [target.material].flat()){
   material.vertexColors=false;
  }
 }
 // The eight finish swatches do not add geometry or scene objects at runtime.
 appearance.traverse(mesh=>{if(mesh.isMesh&&!usedGeometry.has(mesh.geometry))mesh.geometry.dispose()});
 const retainedMaterials=new Set(),retainedGeometry=new Set();
 model.traverse(mesh=>{if(mesh.isMesh){retainedGeometry.add(mesh.geometry);for(const m of [mesh.material].flat())retainedMaterials.add(m)}});
 for(const geometry of replacedGeometry)if(!retainedGeometry.has(geometry))geometry.dispose();
 appearance.traverse(mesh=>{if(mesh.isMesh)for(const m of [mesh.material].flat())if(!retainedMaterials.has(m))m.dispose()});
 appearance.clear();
 model.userData.cleanPrototype={components:finishes.length+panels.length,source:'KnightEPS_Orbit_to_Workbench.blend'};
}
