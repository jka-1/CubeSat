"""Measure the explicit AA tradeoff; these differences are not equivalence."""
import json, math
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageStat

r=Path(__file__).resolve().parent/'results'
k='legacy-compact-lean-acrylic-bounded-ortho-shadow-certified-cull-region-capture-cheap-prepass'
old=k.replace('ortho-shadow-','')
candidate=json.loads((r/(k+'-fxaa-visual.json')).read_text())
rects=json.loads((r/'push-visual-comparison.json').read_text())['uiRectanglesExcluded']
for name in [k+'-fxaa-visual.json',k+'-shadow-visual.json']:
 for overlay in json.loads((r/name).read_text()).get('uiOverlays',[]):
  b=overlay['rect']
  rect=[math.floor(b['left']),math.floor(b['top']),math.ceil(b['right']),math.ceil(b['bottom'])]
  if rect not in rects:rects.append(rect)
mask=Image.new('L',(955,720),255)
draw=ImageDraw.Draw(mask)
for x1,y1,x2,y2 in rects:draw.rectangle((x1,y1,x2-1,y2-1),fill=0)
n=sum(mask.histogram()[1:]);rows=[]
for view in ['assembled','Regulator_01-top','Regulator_01-bottom','Regulator_01-oblique','MCU_Final-top','MCU_Final-bottom','acrylic']:
 base=k if view in ['assembled','acrylic'] else old
 a=Image.open(r/(base+'-'+view+'.png')).convert('RGB').crop((0,0,955,720))
 b=Image.open(r/(k+'-fxaa-'+view+'.png')).convert('RGB').crop((0,0,955,720))
 d=ImageChops.difference(a,b);channels=d.split()
 maximum=ImageChops.lighter(ImageChops.lighter(channels[0],channels[1]),channels[2]);h=maximum.histogram(mask)
 rows.append({'view':view,'reference':base,'pixelsCompared':n,'maxChannelDifference':max(i for i,v in enumerate(h) if v),'pixelsAbove8':sum(h[9:]),'fractionPixelsAbove8':sum(h[9:])/n,'meanChannelDifference':sum(ImageStat.Stat(d,mask).mean)/3})
result={'note':'FXAA changes antialiasing; this is not pixel equivalence. Board controls predate corrected artwork shadows; boards do not receive shadows. Assembled/acrylic use corrected shadow reference. CSS-pixel screenshots; drawing buffer remains DPR 2.','uiRectanglesExcluded':rects,'comparisons':rows,'browserChecks':candidate['checks'],'dispose':candidate['dispose']}
(r/'push-fxaa-visual-comparison.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(rows))
