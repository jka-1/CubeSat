from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
import json,os,time
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
PREFIX='/verification/twin-architecture-20261110/prototype/'
os.chdir(ROOT)
class Handler(SimpleHTTPRequestHandler):
 def do_GET(self):
  u=urlsplit(self.path)
  if u.path==PREFIX or u.path==PREFIX+'index.html':
   variant=parse_qs(u.query).get('renderer',['legacy'])[0]
   if variant not in ('legacy','node-webgl','node-webgpu'):self.send_error(400);return
   build='three.module.js' if variant=='legacy' else 'three.webgpu.js'
   imports={'three':PREFIX+'vendor/three-r176/'+build,'three/webgpu':PREFIX+'vendor/three-r176/three.webgpu.js','three/tsl':PREFIX+'vendor/three-r176/three.tsl.js','three/addons/':'/site/knight-eps-phase12/viewer/vendor/three/addons/'}
   html=(HERE/'index.html').read_text().replace('<!--IMPORTMAP-->','<script type="importmap">'+json.dumps({'imports':imports})+'</script>')
   data=html.encode();self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  if u.path=='/architecture-events':
   self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-store');self.end_headers()
   try:
    for i in range(360):
     self.wfile.write(('data: '+json.dumps({'battery_voltage_v':15.4+(i%10)/100,'temperature_c':26.5,'status':'SYNTHETIC ARCHITECTURE TEST'})+'\n\n').encode());self.wfile.flush();time.sleep(1)
   except (BrokenPipeError,ConnectionResetError):pass
   return
  if u.path.startswith('/telemetry/'):self.send_error(503);return
  if self.headers.get('If-Modified-Since'):del self.headers['If-Modified-Since']
  super().do_GET()
 def guess_type(self,path):
  return 'text/javascript' if path.endswith(('.mjs','.js')) else super().guess_type(path)
 def log_message(self,*args):pass
if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',8770),Handler).serve_forever()
