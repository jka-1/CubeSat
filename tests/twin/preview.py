"""Local-only test fixture. Never connects to hardware or changes production auth.
Run from the repository: python3 tests/twin/preview.py
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json
import os

os.chdir(Path(__file__).resolve().parents[2])

class Preview(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] == '/telemetry/auth/me':
            body = json.dumps({'enabled': False, 'user': None}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith('/telemetry/'):
            self.send_response(503)
            self.end_headers()
        else:
            super().do_GET()

ThreadingHTTPServer(('127.0.0.1', 8766), Preview).serve_forever()
