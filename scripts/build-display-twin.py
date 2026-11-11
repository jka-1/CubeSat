"""Build the lossless display derivative without changing canonical CAD.

Requires Node >= 22.15 (module hooks), Python 3 and Pillow. Run after the
canonical detailed-twin build. Runtime files never depend on verification/.
"""
from pathlib import Path
import subprocess, tempfile, shutil, json, hashlib, gzip

root=Path(__file__).resolve().parents[1]
tools=root/'scripts/twin-display'
destination=root/'site/knight-eps-phase12/models/display'
with tempfile.TemporaryDirectory(prefix='knight-display-') as temporary:
 output=Path(temporary)
 subprocess.run(['node',str(tools/'compile-display.mjs'),str(output)],check=True)
 for script in ['build-artwork.py','audit-closed.py','compact-vertices.py']:
  subprocess.run(['python3',str(tools/script),str(output)],check=True)
 destination.mkdir(exist_ok=True)
 # Lossless transport only; decoded bytes still match the geometry audit.
 model=(output/'display-compact.glb').read_bytes()
 compressed=gzip.compress(model,compresslevel=9,mtime=0)
 assert gzip.decompress(compressed)==model
 (output/'display-compact.glb.gz').write_bytes(compressed)
 names=['display-compact.glb','display-compact.glb.gz','closed-primitives-compact.json','artwork-masks.json','artwork-masks.bin.gz','compact-report.json','build-report.json']
 for name in names:shutil.copyfile(output/name,destination/name)
 report={'canonicalSHA256':json.loads((output/'build-report.json').read_text())['sourceSHA256'],'files':{name:hashlib.sha256((output/name).read_bytes()).hexdigest() for name in names},'policy':'All source triangles, component identities, artwork dimensions and source texels retained. No quantization or decimation.'}
 (destination/'provenance.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'built':str(destination),'files':len(names)}))
