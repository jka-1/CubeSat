import sys
"""Extract verified two-color artwork as full-size coverage plus color constants.
Source texels can be reconstructed byte-exactly. GPU mip/filter results still
require comparison because RGBA8 and R8 quantize their mip channels differently.
"""
from pathlib import Path
from PIL import Image
from io import BytesIO
import struct,json,gzip,hashlib
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
raw=(ROOT/'site/knight-eps-phase12/models/KnightEPS_Detailed.glb').read_bytes()
jn=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+jn]);binary=memoryview(raw)[28+jn:]
records=[];chunks=[];offset=0;rgba_images=[]
for i in range(2,len(g['images'])):
 view=g['bufferViews'][g['images'][i]['bufferView']];start=view.get('byteOffset',0)
 with Image.open(BytesIO(binary[start:start+view['byteLength']])) as image:
  rgba=image.convert('RGBA');colors=rgba.getcolors(3)
  if not(colors and len(colors)==2 and any(color==(0,0,0,0) for _,color in colors)):
   rgba_images.append({'image':i,'dimensions':list(rgba.size),'sourceRGBA8SHA256':hashlib.sha256(rgba.tobytes()).hexdigest(),'policy':'Original embedded RGBA retained; not representable as constant-color coverage.'});continue
  foreground=next(color for _,color in colors if color!=(0,0,0,0))
  mask=rgba.getchannel('A').point(lambda x:255 if x else 0);data=mask.tobytes()
  # Reconstruct every source texel, not just counts or a visual sample.
  restored=Image.new('RGBA',rgba.size,foreground);restored.putalpha(mask.point(lambda x:foreground[3] if x else 0))
  zero=Image.new('RGBA',rgba.size,(0,0,0,0));reconstructed=Image.composite(restored,zero,mask)
  assert reconstructed.tobytes()==rgba.tobytes()
  records.append({'image':i,'textures':[n for n,t in enumerate(g['textures']) if t.get('source')==i],'dimensions':list(rgba.size),'offset':offset,'length':len(data),'foregroundRGBA':foreground,'maskSHA256':hashlib.sha256(data).hexdigest(),'sourceRGBA8SHA256':hashlib.sha256(rgba.tobytes()).hexdigest(),'sourceTexelsExact':True})
  chunks.append(data);offset+=len(data)
out=Path(sys.argv[1]);out.mkdir(exist_ok=True)
with (out/'artwork-masks.bin.gz').open('wb') as f:
 with gzip.GzipFile(fileobj=f,mode='wb',mtime=0,compresslevel=9) as zipped:
  for chunk in chunks:zipped.write(chunk)
(out/'artwork-masks.json').write_text(json.dumps({'sourceSHA256':hashlib.sha256(raw).hexdigest(),'decodedMaskBytes':offset,'records':records,'rgbaImages':rgba_images,'mipCaveat':'Exact source texels; generated R8 versus sRGB RGBA8 mips can differ in channel rounding.'},indent=2)+'\n')
# Record affine plane UVs and physical substrate faces before any consolidation.
def values(index):
 a=g['accessors'][index];v=g['bufferViews'][a['bufferView']];n={'VEC2':2,'VEC3':3}[a['type']];assert a['componentType']==5126
 return [struct.unpack_from('<'+'f'*n,binary,v.get('byteOffset',0)+a.get('byteOffset',0)+i*v.get('byteStride',n*4)) for i in range(a['count'])]
boards=[]
for node in g['nodes']:
 if not node.get('name') in ['INA226','Regulator_01','Regulator_02','MCU_Final','LightSensor','TemperatureSensor']:continue
 leaves=[]
 def visit(i):
  n=g['nodes'][i]
  if 'mesh' in n:
   for p in g['meshes'][n['mesh']]['primitives']:leaves.append((n,p))
  for c in n.get('children',[]):visit(c)
 for child in node.get('children',[]):visit(child)
 layers={};substrates=[]
 for n,p in leaves:
  m=g['materials'][p['material']];name=m.get('name','')
  if 'copper traces recovered' in name or 'Original Fusion top silkscreen' in name:
   key='silk' if 'silkscreen' in name else 'top' if 'Top copper' in name else 'bottom'
   layers[key]={'materialName':name,'positions':values(p['attributes']['POSITION']),'uv':values(p['attributes']['TEXCOORD_0']),'texture':m['pbrMetallicRoughness']['baseColorTexture']['index']}
  if any(s.startswith('Board_') for s in n.get('extras',{}).get('source_nodes',[])):
   a=g['accessors'][p['attributes']['POSITION']];substrates.append({'materialName':name,'min':a['min'],'max':a['max']})
 assert set(layers)=={'top','bottom','silk'} and substrates
 boards.append({'id':node['name'],'layers':layers,'substrates':substrates})
(out/'artwork-layout.json').write_text(json.dumps(boards,indent=2)+'\n')
print(json.dumps({'images':len(records),'sourceTexelRoundtrips':str(len(records))+'/'+str(len(records))+' byte exact','rgbaImages':len(rgba_images),'maskBytes':offset,'gzipBytes':(out/'artwork-masks.bin.gz').stat().st_size,'boards':len(boards)}))
