"""Certify exact, consistently outward-oriented closed primitive components.
No welding tolerance, geometry changes, simplification or image processing.
"""
from pathlib import Path
import json,struct,hashlib,collections,time
P=Path(__file__).resolve().parent
raw=(P/'assets/display.glb').read_bytes();n=struct.unpack_from('<I',raw,12)[0];j=json.loads(raw[20:20+n]);binary=raw[28+n:]
def accessor(index):
 a=j['accessors'][index];v=j['bufferViews'][a['bufferView']];types={5126:'f',5125:'I',5123:'H',5121:'B'};c={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];fmt='<'+types[a['componentType']]*c;size=struct.calcsize(fmt);start=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',size)
 return [struct.unpack_from(fmt,binary,start+i*stride) for i in range(a['count'])]
rows=[];start=time.time()
for mi,mesh in enumerate(j['meshes']):
 for pi,p in enumerate(mesh['primitives']):
  mat=j['materials'][p['material']];row={'mesh':mi,'primitive':pi,'material':p['material'],'triangles':j['accessors'][p['indices']]['count']//3,'eligible':False};rows.append(row)
  if not mat.get('doubleSided') or mat.get('alphaMode','OPAQUE')!='OPAQUE':row['reason']='already one-sided or nonopaque';continue
  positions=accessor(p['attributes']['POSITION']);indices=[x[0] for x in accessor(p['indices'])];vertex_ids={};ids=[]
  for xyz in positions:
   if xyz not in vertex_ids:vertex_ids[xyz]=len(vertex_ids)
   ids.append(vertex_ids[xyz])
  count=len(indices)//3;parent=list(range(count));volume=[0.0]*count;edges={};degenerate=False;degenerate_triangles=[]
  def find(x):
   while parent[x]!=x:parent[x]=parent[parent[x]];x=parent[x]
   return x
  for t in range(count):
   ii=indices[t*3:t*3+3];a,b,c=[ids[x] for x in ii];x,y,z=[positions[k] for k in ii]
   if len({a,b,c})!=3:degenerate=True;degenerate_triangles.append(t)
   volume[t]=(x[0]*(y[1]*z[2]-y[2]*z[1])+x[1]*(y[2]*z[0]-y[0]*z[2])+x[2]*(y[0]*z[1]-y[1]*z[0]))/6
   for u,v in [(a,b),(b,c),(c,a)]:
    key=(min(u,v),max(u,v));sign=1 if u<v else -1
    if key in edges:
     old=edges[key];parent[find(t)]=find(old[2]);old[0]+=1;old[1]+=sign
    else:edges[key]=[1,sign,t]
  bad=sum(count!=2 or direction!=0 for count,direction,_ in edges.values());volumes=collections.defaultdict(float)
  for t,v in enumerate(volume):volumes[find(t)]+=v
  invalid={find(t) for t in degenerate_triangles}
  for incidents,direction,t in edges.values():
   if incidents!=2 or direction!=0:invalid.add(find(t))
  eligible_components={component for component,v in volumes.items() if v>1e-18 and component not in invalid}
  ranges=[]
  for t in range(count):
   if find(t) not in eligible_components:continue
   if ranges and ranges[-1][0]+ranges[-1][1]==t*3:ranges[-1][1]+=3
   else:ranges.append([t*3,3])
  row['closedRanges']=ranges;row['closedTriangles']=sum(n for _,n in ranges)//3
  row.update({'badEdges':bad,'degenerate':degenerate,'connectedComponents':len(volumes),'minimumSignedVolume':min(volumes.values(),default=0),'eligible':not degenerate and bad==0 and all(v>1e-18 for v in volumes.values())})
  row['reason']='closed outward manifold' if row['eligible'] else 'uncertified topology or winding'
report={'displaySHA256':hashlib.sha256(raw).hexdigest(),'policy':'exact coordinate equality; two opposed incidents per edge; positive signed volume for every edge-connected component; opaque double-sided only','primitives':rows,'eligibleTriangles':sum(r['triangles'] for r in rows if r['eligible']),'partialEligibleTriangles':sum(r.get('closedTriangles',0) for r in rows),'uniqueTriangles':sum(r['triangles'] for r in rows),'seconds':time.time()-start}
(P/'assets/closed-primitives.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='primitives'}))
