"""Local pilot only: inject probes into served responses, preserve shipped files."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import json, os, base64
ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = Path(__file__).resolve().parent
PREFIX = '/verification/twin-optimization-20261109/'
os.chdir(ROOT)
class Handler(SimpleHTTPRequestHandler):
 def reply(self, body, kind, cache='no-store'):
  if isinstance(body,str): body=body.encode()
  self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Cache-Control',cache);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_GET(self):
  u=urlsplit(self.path);q=parse_qs(u.query)
  if u.path.startswith('/telemetry/'):self.send_error(503);return
  if u.path=='/site/knight-eps-phase12/viewer/':
   s=(ROOT/u.path.lstrip('/')/'index.html').read_text();s=s.replace('main.mjs?v=20261109a','main.mjs?'+u.query);self.reply(s,'text/html');return
  if u.path=='/site/knight-eps-phase12/viewer/main.mjs':
   s=(ROOT/u.path.lstrip('/')).read_text()
   stamp=str((EVIDENCE/'pilot-loader.mjs').stat().st_mtime_ns)
   s="import {beginProbe,loadPilot,install} from '"+PREFIX+"pilot-loader.mjs?v="+stamp+"';\nbeginProbe();\n"+s
   s=s.replace('new GLTFLoader().loadAsync(url.href)','loadPilot(THREE,renderer,url.href)')
   # Fix the experimental buffer sizes even if the desktop browser's native DPR changes.
   s=s.replace("Math.min(devicePixelRatio||1,quality==='studio'?2:1)","(quality==='studio'?2:1)")
   s=s.replace('window.knightEPSTwin=api;', 'install({THREE,renderer,scene,camera,controls,api,parts:meshes,clearSelection:()=>select(null)});window.knightEPSTwin=api;')
   self.reply(s,'text/javascript');return
  if u.path=='/site/knight-eps-phase12/viewer/vendor/three/build/three.module.js':
   s=(ROOT/u.path.lstrip('/')).read_text()
   # Non-overlapping asynchronous GPU queries, only in the local fixture.
   for statement,name in [('shadowMap.render( shadowsArray, scene, camera );','shadow'),('renderTransmissionPass( opaqueObjects, transmissiveObjects, scene, camera );','transmission'),('renderScene( currentRenderList, scene, camera );','main')]:
    replacement="{ globalThis.__twinDeliveryPass?.begin('"+name+"'); "+statement+" globalThis.__twinDeliveryPass?.end('"+name+"'); }"
    s=s.replace(statement,replacement)
   s=s.replace('const activeViewport = camera.viewport || _currentViewport;', 'globalThis.__twinDeliveryPass?.target(transmissionRenderTarget);\n\t\t\tconst activeViewport = camera.viewport || _currentViewport;')
   self.reply(s,'text/javascript');return
  if u.path.startswith(PREFIX+'delivery-assets/') or u.path.startswith(PREFIX+'delivery-vendor/'):
   p=(ROOT/u.path.lstrip('/')).resolve()
   if not p.is_relative_to(EVIDENCE) or not p.is_file():self.send_error(404);return
   kind='application/wasm' if p.suffix=='.wasm' else 'text/javascript' if p.suffix in ('.js','.mjs') else 'model/gltf-binary' if p.suffix=='.glb' else self.guess_type(str(p))
   self.reply(p.read_bytes(),kind,'public, max-age=3600');return
  if u.path.startswith(PREFIX) and u.path.endswith('.mjs') and '/delivery-vendor/' not in u.path:
   p=(ROOT/u.path.lstrip('/')).resolve()
   if not p.is_relative_to(EVIDENCE) or not p.is_file():self.send_error(404);return
   self.reply(p.read_bytes(),'text/javascript');return
  super().do_GET()
 def do_POST(self):
  if self.path not in ('/__delivery_result','/__delivery_image'):self.send_error(404);return
  data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  if self.path=='/__delivery_image':
   name=data['name']
   if not name.replace('-','').replace('_','').isalnum():self.send_error(400);return
   (EVIDENCE/('delivery-'+name+'.png')).write_bytes(base64.b64decode(data['data'].split(',')[1]))
  else:(EVIDENCE/'delivery-results.json').write_text(json.dumps(data,indent=2)+'\n')
  self.reply('Saved','text/plain')
 def log_message(self,fmt,*args):
  if args and ('404' in str(args) or '500' in str(args)):super().log_message(fmt,*args)
if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',8769),Handler).serve_forever()
