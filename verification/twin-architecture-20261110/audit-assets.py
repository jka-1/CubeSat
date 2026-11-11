"""Read-only source-GLB audit; writes only this directory's evidence JSON.

Run from any directory with Python 3 and Pillow. Does not decode through a GPU,
measure VRAM, rewrite source assets, or infer hidden/screen-space overdraw.
"""
from pathlib import Path
from collections import Counter
from io import BytesIO
from hashlib import sha256
import json
import struct
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = ROOT / 'site/knight-eps-phase12/models/KnightEPS_Detailed.glb'
raw = SOURCE.read_bytes()
assert raw[:4] == b'glTF' and struct.unpack_from('<I', raw, 8)[0] == len(raw)
json_length = struct.unpack_from('<I', raw, 12)[0]
g = json.loads(raw[20:20 + json_length])
binary = memoryview(raw)[28 + json_length:]
node_refs = Counter(n['mesh'] for n in g['nodes'] if 'mesh' in n)
types = {5121: ('B', 1), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
sizes = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def triangles(p):
    return g['accessors'][p.get('indices', p['attributes']['POSITION'])]['count'] // 3

def coordinates(accessor):
    a = g['accessors'][accessor]
    v = g['bufferViews'][a['bufferView']]
    fmt, size = types[a['componentType']]
    count = sizes[a['type']]
    offset = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride', size * count)
    return [struct.unpack_from('<' + fmt * count, binary, offset + i * stride) for i in range(a['count'])]

primitives = [(i, p) for i, m in enumerate(g['meshes']) for p in m['primitives']]
images = []
artwork = []
for image_id, img in enumerate(g['images']):
    view = g['bufferViews'][img['bufferView']]
    start = view.get('byteOffset', 0)
    encoded = binary[start:start + view['byteLength']]
    with Image.open(BytesIO(encoded)) as opened:
        rgba = opened.convert('RGBA')
        histogram = rgba.getchannel('A').histogram()
        count = rgba.width * rgba.height
        mip_bytes = 0
        w, h = rgba.size
        while True:
            mip_bytes += w * h * 4
            if w == h == 1:
                break
            w, h = max(1, w // 2), max(1, h // 2)
        record = {'image': image_id, 'dimensions': list(rgba.size), 'encodedBytes': len(encoded),
                  'alphaZero': histogram[0], 'alpha255': histogram[255],
                  'alphaIntermediate': sum(histogram[1:255]),
                  'nonzeroAlphaFraction': (count - histogram[0]) / count,
                  'alphaValues': [i for i, n in enumerate(histogram) if n],
                  'rgba8BytesWithMipsEstimate': mip_bytes}
    images.append(record)
    texture_ids = [i for i, t in enumerate(g['textures']) if t.get('source') == image_id]
    for mat_id, material in enumerate(g['materials']):
        texture = material.get('pbrMetallicRoughness', {}).get('baseColorTexture', {}).get('index')
        if texture not in texture_ids:
            continue
        for mesh_id, primitive in primitives:
            if primitive.get('material') != mat_id:
                continue
            a = g['accessors'][primitive['attributes']['POSITION']]
            minimum, maximum = a.get('min'), a.get('max')
            nodes = [n for n in g['nodes'] if n.get('mesh') == mesh_id]
            # Axis span and distinct-coordinate counts establish whether this is
            # a simple billboard or detailed tessellated carrier geometry.
            positions = coordinates(primitive['attributes']['POSITION'])
            distinct_axis = [len({v[k] for v in positions}) for k in range(3)]
            artwork.append({'image': image_id, 'material': mat_id, 'name': material.get('name'),
                            'alphaMode': material.get('alphaMode', 'OPAQUE'),
                            'doubleSided': material.get('doubleSided', False),
                            'trianglesPerMesh': triangles(primitive), 'instances': node_refs[mesh_id],
                            'boundsLocalMeters': [minimum, maximum],
                            'spanLocalMeters': [maximum[k] - minimum[k] for k in range(3)] if minimum else None,
                            'distinctPositionCoordinatesPerAxis': distinct_axis,
                            'sourceNodes': nodes[0].get('extras', {}).get('source_nodes', []) if nodes else [],
                            'nodes': [n.get('name') for n in nodes]})

index_counts = Counter()
index_bytes = 0
eligible_uint16_savings = 0
for mesh_id, p in primitives:
    if 'indices' not in p:
        continue
    a = g['accessors'][p['indices']]
    index_counts[str(a['componentType'])] += 1
    index_bytes += a['count'] * types[a['componentType']][1]
    if a['componentType'] == 5125:
        indices = coordinates(p['indices'])
        if max(x[0] for x in indices) <= 65535:
            eligible_uint16_savings += a['count'] * 2

output = {'source': str(SOURCE.relative_to(ROOT)), 'sha256': sha256(raw).hexdigest(),
          'logicalTriangles': sum(triangles(p) * node_refs[i] for i, p in primitives),
          'uniqueMeshTriangles': sum(triangles(p) for _, p in primitives),
          'indexComponentTypesByPrimitive': dict(index_counts),
          'uniqueMeshIndexBytes': index_bytes,
          'possibleLosslessUint16IndexSavingsBytes': eligible_uint16_savings,
          'images': images, 'artworkPrimitives': artwork,
          'limits': ['Static source audit; no runtime allocation, overdraw or performance measurement.',
                     'Alpha histograms describe original mip zero, not filtering or generated mipmaps.',
                     'Local bounds do not establish screen coverage, layer separation or world transforms.',
                     'Uint16 opportunity assumes independent primitive buffers; excludes splitting meshes or quantization.']}
assert output['logicalTriangles'] == 874229
assert len(images) == 17
(HERE / 'asset-audit.json').write_text(json.dumps(output, indent=2) + '\n')
print(json.dumps({'sha256': output['sha256'], 'logicalTriangles': output['logicalTriangles'],
                  'uniqueMeshTriangles': output['uniqueMeshTriangles'],
                  'possibleLosslessUint16IndexSavingsBytes': eligible_uint16_savings,
                  'pcbImages': [{k: i[k] for k in ('image', 'dimensions', 'alphaZero', 'alpha255', 'alphaIntermediate', 'nonzeroAlphaFraction')}
                                for i in images if i['dimensions'][0] == 3000],
                  'texturedMeshes': [{k: a[k] for k in ('image', 'name', 'alphaMode', 'trianglesPerMesh', 'instances', 'spanLocalMeters')}
                                     for a in artwork]}, indent=2))
