from pathlib import Path
import json,statistics,math
HERE=Path(__file__).resolve().parent
def stats(values):
 if not values:return None
 s=sorted(values)
 return {'samples':len(s),'median':statistics.median(s),'p95':s[math.ceil(.95*len(s))-1],'p99':s[math.ceil(.99*len(s))-1],'max':s[-1]}
reports=[]
for path in sorted((HERE/'results').glob('*.json')):
 if path.name.startswith('INVALID-'):continue
 d=json.loads(path.read_text())
 if not isinstance(d,dict):continue
 if d.get('appearance')=='cost-floor':continue
 if not d.get('complete') or not d.get('interactions'):continue
 r={'file':path.name,'backend':d['backend'],'hardware':d['hardware'],'presentationQualification':'Unavailable: active display measured at 30 Hz','materialMiBEstimate':d['memory']['materialBytesEstimate']/1048576,'interactions':[]}
 for x in d['interactions']:
  intervals=[v['intervalMs'] for v in x['samples']];elapsed=x.get('elapsedMs',x['requestedDurationMs']);gpu=stats(x['gpuMs']);s=stats(intervals)
  fraction=sum(v>25 for v in intervals)/len(intervals)
  r['interactions'].append({'name':x['name'],'elapsedMs':elapsed,'renderedFrames':len(intervals)+1,'fps':(len(intervals)+1)/elapsed*1000,'frameMs':s,'cpuRenderSubmitMs':stats([v['cpuMs'] for v in x['samples'] if 'cpuMs' in v]),'gpuMs':gpu,'fractionAbove25ms':fraction,'draws':stats([v['draws'] for v in x['samples'] if 'draws' in v]),'triangles':stats([v['triangles'] for v in x['samples'] if 'triangles' in v]),'passesCadence':s['p95']<=17.667 and fraction<.01,'intervalSumMs':sum(intervals)})
 reports.append(r)
(HERE/'results/summary.json').write_text(json.dumps(reports,indent=2)+'\n')
print(json.dumps([{'file':r['file'],'backend':r['backend'],'materialMiB':round(r['materialMiBEstimate'],2),'interactions':[{'name':x['name'],'fps':round(x['fps'],1),'medianMs':round(x['frameMs']['median'],2),'p95Ms':round(x['frameMs']['p95'],2),'gpuMedianMs':round(x['gpuMs']['median'],2) if x['gpuMs'] else None,'passes':x['passesCadence']} for x in r['interactions']]} for r in reports],indent=2))
