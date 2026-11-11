"""Local, read-only A/B fixture. Does not alter shipped viewer source or access hardware.
Run from the repository: python3 verification/twin-performance-20261109/profile_server.py
Open http://127.0.0.1:8767/site/knight-eps-phase12/viewer/
Append ?depth=standard for the depth-buffer diagnostic (visual correctness not assured).
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import json
import os

ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)


def instrument(source, standard_depth=False):
    source = "import {installProfile} from '/verification/twin-performance-20261109/profile.mjs';\n" + source
    if standard_depth:
        source = source.replace('logarithmicDepthBuffer:true', 'logarithmicDepthBuffer:false')
    source = source.replace('window.knightEPSTwin=api;', 'const profile=installProfile({THREE,renderer,scene,camera,controls,api,getParts:()=>meshes});window.knightEPSTwin=api;')
    source = source.replace('const dt=Math.min((now-lastTime)', 'const frameStart=performance.now();const dt=Math.min((now-lastTime)')
    source = source.replace('const openTarget=topRemoved', 'if(!profile.skipAssemblyUpdates||pendingFit){const openTarget=topRemoved')
    source = source.replace('if(cameraTransition){const t=', '}if(cameraTransition){const t=')
    source = source.replace('renderer.render(scene,camera)\n', 'profile.beforeRender(now,performance.now()-frameStart);renderer.render(scene,camera);profile.afterRender(performance.now()-frameStart)\n')
    return source


class ProfileServer(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/__profile_result':
            self.send_error(404)
            return
        report = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        depth = report['depth']
        if depth not in ('logarithmic', 'standard'):
            self.send_error(400)
            return
        destination = ROOT / 'verification/twin-performance-20261109' / (depth + '.json')
        destination.write_text(json.dumps(report, indent=2) + '\n')
        self.reply('Saved local measurements', 'text/plain')

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path.startswith('/telemetry/'):
            self.send_error(503, 'Profiling fixture has no telemetry or hardware connection')
            return
        target = ROOT / url.path.lstrip('/')
        if url.path == '/site/knight-eps-phase12/viewer/':
            body = (target / 'index.html').read_text()
            if parse_qs(url.query).get('depth') == ['standard']:
                body = body.replace('main.mjs?v=20261109a', 'main.mjs?depth=standard')
            self.reply(body, 'text/html')
        elif url.path == '/site/knight-eps-phase12/viewer/main.mjs':
            self.reply(instrument(target.read_text(), parse_qs(url.query).get('depth') == ['standard']), 'text/javascript')
        else:
            super().do_GET()

    def reply(self, source, content_type):
        body = source.encode()
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8767), ProfileServer).serve_forever()
