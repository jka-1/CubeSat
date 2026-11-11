const revision='20261111-sync';
const recoveries=new WeakMap();

// An already-open SPA retains its old adapter after a static-site update, even
// when its newly loaded iframe has the current LCD. The old adapter sends only
// three fields and no snapshot/sample timestamp. Refresh that dashboard once;
// do not turn its incomplete payload into apparently fresh live telemetry.
export function recoverLegacyDashboard(win,options={}){
 if(options.source!=='live'||options.snapshot===true)return null;
 let parent,url;
 try{
  parent=win.parent;
  if(parent===win||!win.frameElement||parent.document.getElementById('knight-eps-twin')!==win.frameElement)return null;
  url=new URL(parent.location.href);
  if(url.origin!==win.location.origin||url.hash!=='#twin')return null;
 }catch{return null} // Standalone and third-party integrations keep the public API.
 if(recoveries.has(win))return recoveries.get(win);
 if(url.searchParams.get('twinTelemetry')===revision)return 'blocked';
 url.searchParams.set('twinTelemetry',revision);
 // Multiple SSE packets may arrive before the browser commits the navigation.
 recoveries.set(win,'refreshing');
 try{parent.location.replace(url.href);return 'refreshing'}catch{recoveries.set(win,'blocked');return 'blocked'}
}
