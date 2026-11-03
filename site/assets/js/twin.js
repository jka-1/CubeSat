// Digital-twin page: Autodesk Viewer v7 showing the APS-translated CubeSat model.
const API = (window.CUBESAT_BRIDGE_BASE || '/telemetry') + '/aps';
const VIEWER_VERSION = '7.*';
const CDN = `https://developer.api.autodesk.com/modelderivative/v2/viewers/${VIEWER_VERSION}`;
let viewer = null;
let scriptPromise = null;

function setStatus(text, ok) {
  const el = document.getElementById('twinStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('offline', !ok);
  el.classList.toggle('online', Boolean(ok));
}

function loadViewerAssets() {
  if (window.Autodesk?.Viewing) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${CDN}/style.min.css`;
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = `${CDN}/viewer3D.min.js`;
    script.onload = resolve;
    script.onerror = () => { scriptPromise = null; reject(new Error('Autodesk Viewer script failed to load')); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

async function getJson(path) {
  const res = await fetch(`${API}${path}`, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

export async function initTwinPage() {
  try {
    const model = await getJson('/model');
    if (!model.enabled || !model.urn) { setStatus('Not configured', false); return; }
    document.getElementById('twinUrn').textContent = 'APS SVF2 · ready';
    await loadViewerAssets();
    const Av = window.Autodesk.Viewing;
    await new Promise((resolve) => Av.Initializer({
      env: 'AutodeskProduction2', api: 'streamingV2',
      getAccessToken: (done) => getJson('/token')
        .then((t) => done(t.access_token, t.expires_in))
        .catch((e) => setStatus(e.message, false))
    }, resolve));
    const container = document.getElementById('twinViewer');
    if (!container) return;
    viewer = new Av.GuiViewer3D(container);
    viewer.start();
    Av.Document.load(`urn:${model.urn}`, (doc) => {
      const node = doc.getRoot().getDefaultGeometry();
      viewer.loadDocumentNode(doc, node).then(() => {
        setStatus('Model loaded', true);
        window.__twinLoaded = true;
      });
    }, (code, msg) => setStatus(`Load failed (${code}) ${msg || ''}`, false));
  } catch (error) {
    setStatus(error.message, false);
  }
}

export function destroyTwinPage() {
  if (viewer) { viewer.finish(); viewer = null; }
}
