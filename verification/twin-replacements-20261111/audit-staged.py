"""Independent comparison of staged imports to recoverable pre-change assets."""
import json,struct,hashlib,tarfile
from pathlib import Path
here=Path(__file__).resolve().parent;root=here.parents[1];base=root/'site/knight-eps-phase12'
def glb(raw):
 n=struct.unpack_from('<I',raw,12)[0];return json.loads(raw[20:20+n]),raw[28+n:]
with tarfile.open(here/'baseline-assets.tgz') as archive:
 old=glb(archive.extractfile('site/knight-eps-phase12/models/KnightEPS_Detailed.glb').read())
new=glb((here/'staged/models/KnightEPS_Detailed.glb').read_bytes())
def attribute(g,i):
 j,b=g;a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];sizes={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4};width={5126:4,5125:4,5123:2,5121:1}[a['componentType']]*sizes[a['type']];s=v.get('byteOffset',0)+a.get('byteOffset',0);assert v.get('byteStride',width)==width
 return hashlib.sha256(b[s:s+a['count']*width]).hexdigest()
def leaves(g,node):
 j,_=g;result=[]
 if 'mesh' in node:
  for p in j['meshes'][node['mesh']]['primitives']:
   result.append({'attributes':{k:attribute(g,v) for k,v in p['attributes'].items()},'indices':attribute(g,p['indices']),'material':j['materials'][p['material']]})
 for c in node.get('children',[]):result+=leaves(g,j['nodes'][c])
 return result
metadata=json.loads((base/'docs/component_manifest.json').read_text());pair={'BMS_BQ76942','Charger_BMS034A_EVM'};unchanged=[]
for name in metadata['components']:
 before=next(n for n in old[0]['nodes'] if n.get('name')==name);after=next(n for n in new[0]['nodes'] if n.get('name')==name)
 for key in ['matrix','rotation','translation','scale']:assert before.get(key)==after.get(key),(name,key)
 if name not in pair:
  assert leaves(old,before)==leaves(new,after),name;unchanged.append(name)
def triangles(g):
 j,_=g
 def visit(i):
  n=j['nodes'][i];return (sum(j['accessors'][p['indices']]['count']//3 for p in j['meshes'][n['mesh']]['primitives']) if 'mesh' in n else 0)+sum(visit(c) for c in n.get('children',[]))
 return sum(visit(i) for i in j['scenes'][j['scene']]['nodes'])
report=json.loads((here/'staged/docs/model-upgrades.json').read_text())
assert triangles(old)==874229
assert triangles(new)==874229-121190-31760+117816+32036==871131
assert report['logical_triangles']==871131
result={'unaffectedComponentsByteExact':len(unchanged),'all95AnchorTransformsExact':True,'beforeTriangles':triangles(old),'afterTriangles':triangles(new),'replacementTriangleAccounting':{'removedMPPT':121190,'removedBMS':31760,'suppliedMPPT':117816,'suppliedBMS':32036},'boards':[b for b in report['boards'] if b['id'] in pair]}
(here/'staged-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='boards'}))
