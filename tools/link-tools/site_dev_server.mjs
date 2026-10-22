#!/usr/bin/env node
// Local stand-in for Apache: serves the repo's site/ statically and proxies /telemetry/* to the bridge
// (mirrors the README's Apache layout: /telemetry/events, /telemetry/health, /telemetry/command).
// node site_dev_server.mjs --site ../../site --port 8090 --bridge http://127.0.0.1:8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const a = {}; const av = process.argv.slice(2);
for (let i = 0; i < av.length; i += 2) a[av[i].replace(/^--/, '')] = av[i + 1];
const root = path.resolve(a.site || fileURLToPath(new URL('../../site', import.meta.url)));
const bridge = new URL(a.bridge || 'http://127.0.0.1:8080');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/telemetry/')) {
    const p = http.request({ host: bridge.hostname, port: bridge.port, path: u.pathname.slice('/telemetry'.length) + u.search, method: req.method, headers: req.headers }, (pr) => {
      res.writeHead(pr.statusCode, pr.headers); pr.pipe(res);
    });
    p.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('bridge down'); });
    res.on('close', () => p.destroy()); // abort upstream SSE when the browser closes its EventSource
    req.pipe(p); return;
  }
  let f = path.join(root, decodeURIComponent(u.pathname));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (u.pathname.endsWith('/')) f = path.join(f, 'index.html');
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d);
  });
}).listen(Number(a.port || 8090), '127.0.0.1', () => console.log(`site on http://127.0.0.1:${a.port || 8090}/`));
