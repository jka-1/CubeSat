"""Offline summaries only; never rewrites measurements or source/model assets."""
from pathlib import Path
from statistics import median
from PIL import Image, ImageChops, ImageStat
import json, math
HERE=Path(__file__).resolve().parent
data=json.loads((HERE/'delivery-results.json').read_text())
output={'loading':[],'rendering':[],'visual':[],'excludedRuns':[],'memory':[]}
for variant in ('original','ktx2','meshopt'):
 for cache in ('cold','warm'):
  runs=[r for r in data['runs'] if r['variant']==variant and r['cache']==cache and r['mode']=='load' and r.get('complete')]
  metrics={}
  for name in ('fetchMs','parseIncludingDecodeMs','firstUsableRAFms','firstModelRenderCPUms','uploadSubmissionCPUms','meshDecodeCPUms'):
   values=[r['loadingSummary'][name] for r in runs]
   if values:metrics[name]={'min':min(values),'median':median(values),'max':max(values),'samples':len(values)}
  output['loading'].append({'variant':variant,'cache':cache,**metrics})
 # Successful validation is separate from timing: a later fixture selection
 # failure did not affect previously finished whole-frame timing observations.
 valid=[r for r in data['runs'] if r['variant']==variant and any('total' in i['gpuPassMs'] for i in r['interactions'])]
 if valid:
  record=valid[-1];output['rendering'].append({'variant':variant,'recordMode':record['mode'],'recordComplete':record.get('complete',False),'laterFixtureError':record.get('error'),'interactions':record['interactions']})
 completed=[r for r in data['runs'] if r['variant']==variant and r['mode'] in ('full','visual','resume') and r.get('complete')]
 if completed:
  record=completed[-1];output['memory'].append({'variant':variant,'materialBytes':record['residency']['estimatedMaterialTextureBytes'],'trackedGLTextureBytes':record['residency']['trackedTextureStorageEstimateBytes'],'renderbufferBytes':sum(x['estimatedBytes'] for x in record['trackedRenderbuffers']),'renderbuffers':record['trackedRenderbuffers'],'targets':record['targets'],'logicalTriangles':record['logicalTriangles'],'checks':record['checks'],'webGPUAPIAvailable':record.get('webGPUAPIAvailable')})
for index,r in enumerate(data['runs']):
 if r.get('error'):output['excludedRuns'].append({'index':index,'variant':r['variant'],'mode':r['mode'],'error':r['error'],'reason':'Exclude from successful visual/functional validation. Retain whole-frame timing already completed before the later fixture error; reject the early per-pass-query timings.'})
for variant in ('ktx2','meshopt'):
 for name in ('assembled','lid','exploded','artwork-front','artwork-back','artwork-oblique','acrylic'):
  a=HERE/f'delivery-original-{name}.png';b=HERE/f'delivery-{variant}-{name}.png'
  if not a.exists() or not b.exists():continue
  before=Image.open(a).convert('RGB');after=Image.open(b).convert('RGB')
  if before.size!=after.size:output['visual'].append({'variant':variant,'name':name,'error':'size mismatch'});continue
  diff=ImageChops.difference(before,after);channels=diff.split();mask=ImageChops.lighter(ImageChops.lighter(channels[0],channels[1]),channels[2]);hist=mask.histogram();count=before.width*before.height
  output['visual'].append({'variant':variant,'name':name,'size':before.size,'fractionPixelsOver8':sum(hist[9:])/count,'meanChannelDifference':sum(ImageStat.Stat(diff).mean)/3,'maxChannelDifference':max(i for i,n in enumerate(hist) if n)})
(HERE/'delivery-analysis.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps(output,indent=2))
