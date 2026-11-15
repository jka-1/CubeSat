#!/usr/bin/env python3
"""Loopback-only, read-only website preview for the Figma design baseline.

Uses source HTML and JS with synthetic API responses; never connects to a bridge.
Run: python3 tools/figma/preview.py --port 4173
"""
import argparse
import json
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / 'site'
RUN = {'id': 'design-example', 'name': 'Design example — synthetic recording', 'status': 'completed', 'run_type': 'live_telemetry', 'current_source': 'pv', 'started_ms': 1794762000000, 'ended_ms': 1794762060000, 'last_received_ms': 1794762059000, 'sample_count': 60, 'device_id': 'DESIGN-PREVIEW', 'last_seq': 60, 'end_reason': 'operator_stop'}

SNAPSHOT = r'''
<script>
function geometry(el,win,offsetX=0,offsetY=0) {
  if(['SCRIPT','STYLE','LINK','NOSCRIPT'].includes(el.tagName))return null;
  const cs=win.getComputedStyle(el), r=el.getBoundingClientRect();
  if(cs.display==='none'||cs.visibility==='hidden'||r.width<.1||r.height<.1)return null;
  if(el.tagName==='IFRAME') {try{return geometry(el.contentDocument.body,el.contentWindow,offsetX+r.x,offsetY+r.y);}catch{return null;}}
  const css={};for(const k of ['color','backgroundColor','backgroundImage','borderTopColor','borderTopWidth','borderRadius','fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','textAlign','textTransform','opacity','display','flexDirection','gap','paddingTop','paddingRight','paddingBottom','paddingLeft','overflow'])css[k]=cs[k];
  const n={name:el.id||el.getAttribute('aria-label')||el.className?.baseVal||el.className||el.tagName,tag:el.tagName,x:r.x+offsetX,y:r.y+offsetY,w:r.width,h:r.height,css,children:[],inputType:el.type,checked:el.checked};
  if(el.tagName==='SVG'||el.tagName==='svg'){const svg=el.cloneNode(true);const a=[el,...el.querySelectorAll('*')],b=[svg,...svg.querySelectorAll('*')];for(let i=0;i<a.length;i++){const st=win.getComputedStyle(a[i]);for(const k of ['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','opacity','font-size','font-family'])b[i].style.setProperty(k,st.getPropertyValue(k));}svg.setAttribute('width',r.width);svg.setAttribute('height',r.height);n.svg=new XMLSerializer().serializeToString(svg).replaceAll('currentColor',cs.color);return n;}
  if(el.tagName==='IMG')n.src=el.src;
  if(el.tagName==='CANVAS'){n.image=el.toDataURL();return n;}
  if(['INPUT','TEXTAREA','SELECT'].includes(el.tagName))n.text=el.tagName==='SELECT'?el.selectedOptions[0]?.textContent:(el.type==='password'?'':el.value||el.placeholder||'');
  for(const c of el.childNodes){
    if(c.nodeType===1){const child=geometry(c,win,offsetX,offsetY);if(child)n.children.push(child);}
    else if(c.nodeType===3&&c.textContent.trim()){
      const range=el.ownerDocument.createRange();range.selectNodeContents(c);const b=range.getBoundingClientRect();
      if(b.width>.1&&b.height>.1)n.children.push({tag:'TEXT',name:'Text',text:c.textContent.trim().replace(/\s+/g,' '),x:b.x+offsetX,y:b.y+offsetY,w:b.width,h:b.height,css});
    }
  }
  return n;
}
function snapshot(el, win) {
  if (['SCRIPT','STYLE','LINK','NOSCRIPT'].includes(el.tagName)) return null;
  const s = win.getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden') return null;
  if (el.tagName === 'IFRAME') {
    try { return snapshot(el.contentDocument.body, el.contentWindow); } catch { return null; }
  }
  let copy;
  if(el.tagName === 'CANVAS') {
    copy=document.createElement('img'); copy.src=el.toDataURL();
  } else copy=el.tagName==='BODY'?document.createElement('div'):el.cloneNode(false);
  copy.removeAttribute('id'); copy.removeAttribute('onload');
  for (let i=0;i<s.length;i++) {const k=s[i];copy.style.setProperty(k, s.getPropertyValue(k));}
  copy.style.animation='none'; copy.style.transition='none';
  if(s.position==='fixed') copy.style.position='absolute';
  if(el.tagName==='BODY') {copy.style.position='relative';copy.style.width=win.innerWidth+'px';copy.style.margin='0';}
  if('value' in el) {copy.setAttribute('value',el.value);copy.value=el.value;}
  if('checked' in el && el.checked) copy.setAttribute('checked','');
  if(el.tagName==='SELECT') for(const op of copy.options) op.selected=op.value===el.value;
  if(el.tagName!=='CANVAS') for(const child of el.childNodes) {
    if(child.nodeType===3) copy.appendChild(document.createTextNode(child.textContent));
    else if(child.nodeType===1) {const c=snapshot(child,win);if(c)copy.appendChild(c);}
  }
  for(const side of ['before','after']) {
    const p=win.getComputedStyle(el,'::'+side);
    if(!p.content || ['none','normal'].includes(p.content))continue;
    const pseudo=document.createElement('span');
    for(let i=0;i<p.length;i++){const k=p[i];pseudo.style.setProperty(k,p.getPropertyValue(k));}
    pseudo.style.position=p.position==='fixed'?'absolute':p.position;
    pseudo.textContent=p.content.replace(/^['"]|['"]$/g,'');
    if(side==='before')copy.prepend(pseudo);else copy.append(pseudo);
  }
  return copy;
}
async function settleAndCopy(frame) {
  try {
  await new Promise(resolve=>setTimeout(resolve,4000));
  const doc=frame.contentDocument;
  const key=new URL(frame.src).searchParams;
  if(key.get('route')==='twin')for(let i=0;i<60;i++){
    const status=doc.querySelector('iframe')?.contentDocument?.querySelector('#loader-status')?.textContent||'';
    if(status&&!status.includes('Loading'))break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  await fetch('/__figma_export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({screen:key.get('route')+(key.get('detail')?':'+key.get('detail'):''),width:Number(frame.width),tree:geometry(doc.body,frame.contentWindow)})});
  // Expand pages before copying so long forms and dense tables remain accessible.
  frame.style.height=(doc.documentElement.scrollHeight+20)+'px';
  await new Promise(resolve=>setTimeout(resolve,300));
  const result=snapshot(doc.body,frame.contentWindow);
  const root=document.createElement('div');
  root.style.cssText='position:relative;isolation:isolate;width:'+frame.width+'px;overflow:hidden;';
  root.style.zoom=Math.min(1,(window.innerWidth-64)/Number(frame.width));
  root.appendChild(result);frame.replaceWith(root);
  document.title=document.title+' ✓';
  } catch(e) { const error=document.createElement('p');error.textContent='Export error: '+e.message;frame.before(error); }
}
</script>
'''

BOOT = r'''
<script>
const previewParams = new URLSearchParams(location.search);
const previewRoute = previewParams.get('route') || 'home';
const previewCaptureHash = location.hash;
// The capture script reads its hash before the application selects its route.
setTimeout(() => { location.hash = previewRoute; }, 700);
window.addEventListener('load', () => setTimeout(() => {
  const detail = previewParams.get('detail');
  if (detail) document.querySelector(`[data-detail-target="${detail}"]`)?.click();
  if (previewRoute==='sequences' && detail==='example') {
    document.getElementById('seqName').value='Design example';
    for(const type of ['message','delay','if']) document.querySelector(`[data-add="${type}"]`)?.click();
  }
  if (detail==='library') document.getElementById('seqSavedTrigger')?.click();
  if (detail==='response') {const mode=document.getElementById('analysisMode');if(mode){mode.value='response';mode.dispatchEvent(new Event('change',{bubbles:true}));}}
  if (detail==='streaming') document.getElementById('i2cStreamToggle')?.click();
  if (previewParams.get('mock') === '1') document.getElementById('mockModeToggle')?.click();
  if (previewParams.get('library') === '1') document.getElementById('seqSavedTrigger')?.click();
}, 1400));
</script>
<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>
'''

class Preview(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def send(self, body, kind='application/json', status=200):
        data = (json.dumps(body) if kind == 'application/json' else body).encode()
        self.send_response(status)
        self.send_header('Content-Type', kind + '; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if urlsplit(self.path).path == '/__figma_export':
            data = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
            name = re.sub(r'[^a-zA-Z0-9_-]', '-', data['screen'])
            target = ROOT / 'documentation/design/figma/source-geometry'
            target.mkdir(parents=True, exist_ok=True)
            (target / f"{name}-{int(data['width'])}.json").write_text(json.dumps(data, separators=(',', ':')))
            return self.send({'ok':True})
        self.send({'error': 'Read-only Figma preview; mutations are disabled.'}, status=405)

    do_PUT = do_POST
    do_DELETE = do_POST
    do_PATCH = do_POST

    def do_GET(self):
        path = urlsplit(self.path).path
        params = parse_qs(urlsplit(self.headers.get('Referer', self.path)).query)
        if path == '/capture.html':
            query = parse_qs(urlsplit(self.path).query)
            routes = query.get('screens', ['home'])[0].split(',')
            width = int(query.get('width', ['1440'])[0])
            parts = []
            for screen in routes:
                route, _, detail = screen.partition(':')
                role = 'anonymous' if route in ('home', 'account') else 'operator'
                if detail == 'operator': role = 'operator'
                if detail == 'denied': role = 'viewer'
                src = f'/index.html?embedded=1&route={route}&role={role}&detail={detail}'
                parts.append(f'<article><h2>{screen} / {width}px</h2><iframe data-preview onload="settleAndCopy(this)" src="{src}" width="{width}" height="1100"></iframe></article>')
            self.send('<!doctype html><html><head><meta charset="utf-8"><title>OrbitalAddress / '+','.join(routes)+'</title><style>body{margin:0;padding:32px;background:#202324;color:white;font:16px Arial;width:calc(100vw - 64px)}article{margin-bottom:48px}iframe{border:0;display:block}h2{font-size:20px;margin:0 0 20px}</style>'+SNAPSHOT+'</head><body>'+''.join(parts)+'<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script></body></html>', 'text/html')
        elif path in ('/', '/index.html'):
            own_params = parse_qs(urlsplit(self.path).query)
            boot = BOOT
            if 'embedded' in own_params:
                boot = BOOT.replace('<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>', '')
            self.send((SITE / 'index.html').read_text().replace('</body>', boot + '</body>'), 'text/html')
        elif path.startswith('/telemetry/auth/'):
            role = params.get('role', ['operator'])[0]
            self.send({'enabled': True, 'user': None if role == 'anonymous' else {'username': 'Design preview', 'role': role}, 'control_active': False, 'csrf': 'preview-only'})
        elif path.startswith('/telemetry/operator-pages/'):
            name = path.rsplit('/', 1)[-1]
            if name not in ('manual', 'manual-document', 'debug-mode', 'sequences'):
                return self.send({'error': 'Not found'}, status=404)
            self.send((ROOT / 'telemetry-bridge/auth/views' / (name + '.html')).read_text(), 'text/html')
        elif path in ('/telemetry/events', '/telemetry/public/events'):
            self.send(': Offline design preview\n\n', 'text/event-stream')
        elif path.startswith('/telemetry/'):
            if path.endswith('/health'):
                self.send({'ok': True, 'online': False, 'last_packet_age_ms': None, 'recording': False})
            elif path.endswith('/sequences'):
                self.send({'sequences': [{'id':'design-example','name':'Design example — startup check','revision':1}], 'order': {'version':0, 'ids':['design-example']}})
            elif path.endswith('/sequence-executions'):
                self.send({'executions': []})
            elif path.endswith('/runs'):
                self.send({'runs': [RUN], 'recording': {'enabled': True, 'active': None}})
            elif path.endswith('/runs/design-example'):
                self.send({'run': RUN})
            elif path.endswith('/series'):
                self.send({'points': [{'start_ms':RUN['started_ms']+i*1000,'end_ms':RUN['started_ms']+(i+1)*1000,'mean':12+(i%8)*.1,'min':11.9+(i%8)*.1,'max':12.1+(i%8)*.1,'count':1} for i in range(60)]})
            elif path.endswith('/samples'):
                self.send({'items': [{'received_ms':RUN['started_ms']+i*1000,'seq':i,'mode':'live_telemetry','power_source':'pv','packet_order':i,'envelope':{'packet':{'telemetry':{'pv':{'busVoltageV':12.4,'currentA':.4,'powerW':4.96}}}}} for i in range(5)], 'next_after':None})
            elif path.endswith('/events'):
                self.send({'events':[], 'items':[], 'next_after':None})
            elif path.endswith('/status'):
                self.send({'active': None, 'recording': False, 'recoveryRequired': False})
            elif path.endswith('/register-registry'):
                self.send({'revision': 0, 'registers': []})
            else:
                self.send({})
        else:
            super().do_GET()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4173)
    args = parser.parse_args()
    print(f'Figma preview: http://127.0.0.1:{args.port}/?route=home', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Preview).serve_forever()
