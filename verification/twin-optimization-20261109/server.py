"""Local focused A/B fixture; no hardware or production routes."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
import json,os
ROOT=Path(__file__).resolve().parents[2]
EVIDENCE=Path(__file__).resolve().parent
os.chdir(ROOT)
class Handler(SimpleHTTPRequestHandler):
 def reply(self,body,kind):
  body=body.encode();self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_GET(self):
  u=urlsplit(self.path);query=parse_qs(u.query)
  if u.path.startswith('/telemetry/'):self.send_error(503);return
  if u.path=='/site/knight-eps-phase12/viewer/':
   s=(ROOT/u.path.lstrip('/')/'index.html').read_text();s=s.replace('main.mjs?v=20261109a','main.mjs?variant='+query.get('variant',['optimized'])[0]);self.reply(s,'text/html');return
  if u.path=='/site/knight-eps-phase12/viewer/main.mjs':
   baseline=query.get('variant')==['baseline'];s=(EVIDENCE/'baseline-main.mjs' if baseline else ROOT/u.path.lstrip('/')).read_text()
   s="import {install} from '/verification/twin-optimization-20261109/measure.mjs';\n"+s
   if baseline:s=s.replace("'./display.mjs'","'./display.mjs?baseline=1'")
   s=s.replace('window.knightEPSTwin=api;',"const profile=install({THREE,renderer,scene,camera,controls,api,parts:meshes,variant:'"+('baseline' if baseline else 'optimized')+"'});window.knightEPSTwin=api;")
   s=s.replace('function animate(now){','function animate(now){profile.beginFrame(now);')
   self.reply(s,'text/javascript');return
  if u.path=='/site/knight-eps-phase12/viewer/display.mjs' and query.get('baseline')==['1']:self.reply((EVIDENCE/'baseline-display.mjs').read_text(),'text/javascript');return
  super().do_GET()
 def do_POST(self):
  if self.path=='/__image':
   import base64
   data=json.loads(self.rfile.read(int(self.headers['Content-Length'])));name=data['name'];assert name.replace('-','').replace('_','').isalnum()
   (EVIDENCE/(name+'.png')).write_bytes(base64.b64decode(data['data'].split(',')[1]));self.reply('Saved','text/plain');return
  if self.path!='/__result':self.send_error(404);return
  data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  name=data.get('name');assert name in ('baseline','optimized','visual')
  (EVIDENCE/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n');self.reply('Saved','text/plain')
 def log_message(self,fmt,*args):
  if args and ('404' in str(args) or '500' in str(args)):super().log_message(fmt,*args)
if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',8768),Handler).serve_forever()
