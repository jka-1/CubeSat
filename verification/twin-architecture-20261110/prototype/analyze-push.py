"""Selected exact optimizations, explicit workload/presentation distinction."""
from pathlib import Path
import json,statistics,collections,sys
P=Path(__file__).resolve().parent;R=P/'results';choice=sys.argv[1] if len(sys.argv)>1 else '';shadow=choice in ['ortho','fxaa'];fxaa=choice=='fxaa';K='legacy-compact-lean-acrylic-bounded-'+('ortho-shadow-' if shadow else '')+'certified-cull-region-capture-cheap-prepass'+('-fxaa' if fxaa else '')
def phases(j):
 out=[]
 for a in j['interactions']:
  g=sorted(a['gpuMs']);s=sorted(x['intervalMs'] for x in a['samples']);cpu=sorted(x['callbackCpuMs'] for x in a['samples'] if x.get('callbackCpuMs') is not None);px=[x.get('capturePixels',0) for x in a['samples']]
  out.append({'name':a['name'],'gpuSamples':len(g),'gpuMedianMs':statistics.median(g),'gpuP95Ms':g[int(.95*len(g))],'renderStartP95Ms':s[int(.95*len(s))],'renderRatePerSecond':1000/statistics.mean(s),'fractionIntervalsAbove25ms':sum(t>25 for t in s)/len(s),'callbackCpuP95Ms':cpu[int(.95*len(cpu))] if cpu else None,'captureMedianPixels':statistics.median(px),'captureMaxPixels':max(px),'depthModes':dict(collections.Counter(x['depthMode'] for x in a['samples']))})
 return out
summary={'selectedCandidate':K,'targetHz':60,'frameBudgetMs':1000/60,'gpuHeadroomTargetMs':14,'observedDisplayHz':30,'presentation60HzQualified':False,'newAppearanceReductions':fxaa,'aa':{'mode':'FXAA replacing MSAA' if fxaa else 'four-sample MSAA','defaultChanged':False,'drawingBuffer':[1910,1440]},'sourceAppearanceCaveat':'Existing display-space acrylic alternative; physical HDR transmission remains unqualified.'+(' FXAA changes edge filtering and is an explicit quality alternative.' if fxaa else ''),'compaction':{k:v for k,v in json.loads((P/'assets/compact-report.json').read_text()).items() if k!='proof'}}
for mode in ['load60','hotreplay60','thermal60']:
 f=R/(K+'-timer60-clock-'+mode+'.json')
 if f.exists():
  j=json.loads(f.read_text());assert j['complete'] and not j.get('error');p=phases(j);summary[mode]={'phases':p,'gpuP95HeadroomGatePassed':all(x['gpuP95Ms']<=14 for x in p),'allGpuP95BelowFrameBudget':all(x['gpuP95Ms']<=1000/60 for x in p),'gpuDisjointCounts':[a.get('gpuDisjointCount') for a in j['interactions']],'renderClock':j['renderClock'],'visibilityNote':'Timer-driven workload tests capacity; render-start jitter is not 60 Hz presentation.'}
if 'j' in locals() and j.get('sustainedWarmup'):
 w=j['sustainedWarmup'];g=sorted(w['gpuMs']);late=sorted(w['gpuMs'][-900:]);summary['sustainedWarmup']={'durationMs':w['elapsedMs'],'frames':len(w['samples'])+1,'gpuSamples':len(g),'gpuMedianMs':statistics.median(g),'gpuP95Ms':g[int(.95*len(g))],'last900GpuP95Ms':late[int(.95*len(late))],'gpuDisjointCount':w['gpuDisjointCount']}
visual=R/('push-fxaa-visual-comparison.json' if fxaa else 'push-visual-comparison.json')
if visual.exists():summary['visual']=json.loads(visual.read_text())
f=R/(K+'-qualify.json')
if f.exists():
 j=json.loads(f.read_text());summary['qualification']={k:j.get(k) for k in ['complete','error','depthFallback','cullingFallback','aaResize','dispose']};summary['qualification']['reloadIntegrity']={k:j.get('reload',{}).get(k) for k in ['parts','triangles']}
summary['notSelected']=['Front-to-back opaque sorting: no consistent tail improvement','Partial closed-face partition: extra calls did not improve tails consistently','Fixed material constants: no consistent animation gain','Matte environment approximation: insufficient gain to justify appearance change','Orthographic shadow path is selected only in the ortho report']
(R/('push-summary-fxaa.json' if fxaa else 'push-summary-ortho.json' if shadow else 'push-summary.json')).write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps({k:v for k,v in summary.items() if k in ['load60','thermal60','sustainedWarmup','qualification']}))
