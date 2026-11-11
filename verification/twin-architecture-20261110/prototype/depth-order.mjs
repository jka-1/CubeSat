// Preserve explicit scene ordering. Within it, cover distant opaque surfaces
// early to reduce fragment work; retain the engine's stable tie breakers.
export function depthFirstOpaque(a,b){
 return a.groupOrder-b.groupOrder||a.renderOrder-b.renderOrder||a.z-b.z||a.material.id-b.material.id||a.id-b.id;
}
