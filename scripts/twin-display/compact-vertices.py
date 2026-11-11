import sys
"""Exact attribute-byte deduplication; preserve every indexed triangle in order."""
from pathlib import Path
import json,struct,hashlib,copy
P=Path(__file__).resolve().parent;A=Path(sys.argv[1]);raw=(A/'display.glb').read_bytes();n=struct.unpack_from('<I',raw,12)[0];src=json.loads(raw[20:20+n]);binary=raw[28+n:]
sha=lambda b:hashlib.sha256(b).hexdigest()
out=copy.deepcopy(src);out['accessors']=[];out['bufferViews']=[];chunks=[];length=0;cache={};before=after=0;proof=[]
def original(ai):
 a=src['accessors'][ai];v=src['bufferViews'][a['bufferView']];size={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]*{5126:4,5125:4,5123:2,5121:1}[a['componentType']];start=v.get('byteOffset',0)+a.get('byteOffset',0)
 if v.get('byteStride',size)!=size:raise ValueError('Unexpected interleaving')
 return a,memoryview(binary)[start:start+a['count']*size],size

def view(data):
 global length
 index=len(out['bufferViews']);out['bufferViews'].append({'buffer':0,'byteOffset':length,'byteLength':len(data)});padded=bytes(data)+b'\0'*((-len(data))%4);chunks.append(padded);length+=len(padded);return index

def acc(data,template,count=None,component=None):
 a=copy.deepcopy(template);a.pop('byteOffset',None);a['bufferView']=view(data)
 if count is not None:a['count']=count
 if component is not None:a['componentType']=component
 index=len(out['accessors']);out['accessors'].append(a);return index
for i,image in enumerate(src['images']):
 v=src['bufferViews'][image['bufferView']];start=v.get('byteOffset',0);out['images'][i]['bufferView']=view(binary[start:start+v['byteLength']])
for mi,mesh in enumerate(src['meshes']):
 for pi,p in enumerate(mesh['primitives']):
  attrs=tuple(sorted(p['attributes'].items()));dest=out['meshes'][mi]['primitives'][pi]
  if attrs not in cache:
   arrays=[(name,*original(ai)) for name,ai in attrs];count=arrays[0][1]['count'];seen={};remap=[];streams=[bytearray() for _ in arrays]
   for i in range(count):
    pieces=[data[i*size:(i+1)*size] for _,a,data,size in arrays];key=b''.join(pieces)
    if key not in seen:
     seen[key]=len(seen)
     for target,piece in zip(streams,pieces):target.extend(piece)
    remap.append(seen[key])
   mapped={name:acc(data,a,len(seen)) for (name,a,_,_),data in zip(arrays,streams)};cache[attrs]=(mapped,remap,streams,arrays);before+=count;after+=len(seen)
  mapped,remap,streams,arrays=cache[attrs];dest['attributes']=mapped
  ia,ib,isize=original(p['indices']);indices=struct.unpack('<'+('H' if ia['componentType']==5123 else 'I')*ia['count'],ib);new=[remap[i] for i in indices];ct=5123 if max(new)<=65535 else 5125
  dest['indices']=acc(struct.pack('<'+('H' if ct==5123 else 'I')*len(new),*new),ia,component=ct)
  checks={}
  for (name,_,data,size),stream in zip(arrays,streams):
   oldhash=sha(b''.join(data[i*size:(i+1)*size] for i in indices));newhash=sha(b''.join(memoryview(stream)[i*size:(i+1)*size] for i in new));assert oldhash==newhash;checks[name]=oldhash
  proof.append({'mesh':mi,'primitive':pi,'triangles':len(new)//3,'expandedAttributeSHA256':checks})
out['buffers']=[{'byteLength':length}];out['asset']['generator']='Knight exact vertex compaction; no quantization/decimation'
j=json.dumps(out,separators=(',',':')).encode();j+=b' '*((-len(j))%4);binchunk=b''.join(chunks);result=struct.pack('<4sIIII',b'glTF',2,28+len(j)+len(binchunk),len(j),0x4e4f534a)+j+struct.pack('<II',len(binchunk),0x004e4942)+binchunk
(A/'display-compact.glb').write_bytes(result)
certificate=json.loads((A/'closed-primitives.json').read_text());assert certificate['displaySHA256']==sha(raw);certificate['equivalentSourceSHA256']=sha(raw);certificate['displaySHA256']=sha(result);certificate['equivalenceProof']='compact-report.json: every expanded indexed attribute byte matches in original triangle order';(A/'closed-primitives-compact.json').write_text(json.dumps(certificate,indent=2)+'\n')
report={'sourceSHA256':sha(raw),'outputSHA256':sha(result),'verticesBefore':before,'verticesAfter':after,'bytesBefore':len(raw),'bytesAfter':len(result),'triangleAndAttributeBytesExact':True,'noQuantization':True,'proof':proof};(A/'compact-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='proof'}))
