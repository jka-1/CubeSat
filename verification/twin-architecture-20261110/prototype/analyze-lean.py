"""Summarize the bounded pilot; do not promote short GPU timings to 60 fps."""
from pathlib import Path
from PIL import Image,ImageChops,ImageStat,ImageDraw
from datetime import datetime,timezone
import json,math,statistics
HERE=Path(__file__).resolve().parent
R=HERE/'results'
def read(name):return json.loads((R/name).read_text())
def phase(a):
 g=sorted(a['gpuMs']);t=sorted(s['intervalMs'] for s in a['samples'])
 return {'name':a['name'],'gpuSamples':len(g),'gpuMedianMs':statistics.median(g),'gpuP95Ms':g[int(.95*len(g))],'frameStartMedianMs':statistics.median(t),'frameStartP95Ms':t[int(.95*len(t))]}
key='legacy-packed-lean-acrylic-bounded'
complete=read(key+'-measure.json');assert complete['complete']
result={'targetHz':60,'frameBudgetMs':1000/60,'gpuHeadroomTargetMs':14,'observedDisplayHz':30,'passesCompleteAcceptance':False,'candidate':key,'phases':[phase(a) for a in complete['interactions']],'sourceGeometry':{'components':complete['geometry']['parts'],'triangles':complete['geometry']['triangles']},'materialMiBEstimate':complete['memory']['materialBytesEstimate']/2**20,'viewportCopies':complete['memory']['viewportCopies'],'diagnostics':[]}
for name in ['legacy-original-opaque-pbr-screen.json','legacy-original-opaque-pbr-reverse-screen.json','legacy-original-reverse-screen.json','legacy-packed-lean-acrylic-reverse-screen.json']:
 j=read(name);result['diagnostics'].append({'file':name,'phases':[phase(a) for a in j['interactions']],'qualifiesStudio':False})
# Preserve the raw failed status. Its replayed console event predates navigation;
# timings remain exploratory and do not qualify the shadow experiment.
shadow=read('legacy-packed-lean-acrylic-bounded-ortho-shadow-animation.json')
start=datetime.fromisoformat(shadow['started'].replace('Z','+00:00')).timestamp()*1000
errors=[m['params']['timestamp'] for m in shadow['logs'] if m.get('params',{}).get('type')=='error']
result['shadowExperiment']={'rawMarkedFailure':True,'allConsoleErrorsPredateRun':bool(errors) and all(t<start for t in errors),'consoleErrorTimestampsMs':errors,'runStartTimestampMs':start,'phasesExploratoryOnly':[phase(a) for a in shadow['interactions']],'adopted':False}
views=['assembled','Regulator_01-top','Regulator_01-bottom','Regulator_01-oblique','MCU_Final-top','MCU_Final-bottom','acrylic']
overlay=read(key+'-status.json')['diagnosticOverlay'];rect=(math.floor(overlay['left']),math.floor(overlay['top']),math.ceil(overlay['right']),math.ceil(overlay['bottom']))
comparisons=[]
for view in views:
 a=Image.open(R/f'legacy-original-{view}.png').convert('RGB').crop((0,0,955,720))
 b=Image.open(R/f'{key}-{view}.png').convert('RGB').crop((0,0,955,720))
 diff=ImageChops.difference(a,b);ImageDraw.Draw(diff).rectangle(rect,fill=0)
 red,green,blue=diff.split();h=ImageChops.lighter(ImageChops.lighter(red,green),blue).histogram()
 comparisons.append({'view':view,'maxChannelDifference':max(i for i,n in enumerate(h) if n),'fractionPixelsAbove8':sum(h[9:])/(955*720-(rect[2]-rect[0]+1)*(rect[3]-rect[1]+1)),'meanRGBDifferenceOverWholeCrop':sum(ImageStat.Stat(diff).mean)/3})
result['visual']={'excludedDiagnosticOverlay':rect,'comparisons':comparisons,'appearanceEquivalent':False}
qualification=read(key+'-qualify.json');assert qualification['complete']
result['depthFallback']=qualification['depthFallback'];result['cleanup']=qualification['dispose']
result['limitations']=['30 Hz display prevents 60 Hz presentation qualification, but never changes the 60 fps design target.','GPU measurements were taken at a 30 renders/s work rate, not sustained 60 renders/s.','Acrylic compositing and blur differ from physical HDR transmission.','Animation GPU tails miss the budget; no thermal acceptance run is warranted.','Shader variants can compile on first depth-mode transitions; fallback frame time is unqualified.','Main-view CPU times in the complete run exclude depth-guard preparation; GPU timings remain valid.','Seven image crops and a conservative depth-spacing guard are not exhaustive browser/zoom qualification.']
(R/'lean-summary.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'phases':result['phases'],'completeAcceptance':False,'cleanup':result['cleanup']['renderCountStable']}))
