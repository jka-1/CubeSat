"""Compare matched scene crops; preserve captures and report numerical differences.
These checks do not declare a changed shading model visually equivalent.
"""
from pathlib import Path
from PIL import Image,ImageChops,ImageStat
import json
HERE=Path(__file__).resolve().parent/'results'
output=[]
for candidate in ['packed','surface']:
 for view in ['assembled','Regulator_01-top','Regulator_01-bottom','Regulator_01-oblique','MCU_Final-top','MCU_Final-bottom','acrylic']:
  before=HERE/f'node-webgl-original-{view}.png'
  after=HERE/f'node-webgl-{candidate}-{view}.png'
  if not before.exists() or not after.exists():continue
  a=Image.open(before).convert('RGB').crop((0,0,955,720))
  b=Image.open(after).convert('RGB').crop((0,0,955,720))
  diff=ImageChops.difference(a,b);red,green,blue=diff.split()
  histogram=ImageChops.lighter(ImageChops.lighter(red,green),blue).histogram()
  output.append({'candidate':candidate,'view':view,'meanRGBDifference':sum(ImageStat.Stat(diff).mean)/3,'fractionPixelsAbove8':sum(histogram[9:])/(955*720),'maxChannelDifference':max(i for i,n in enumerate(histogram) if n)})
(HERE/'visual-comparison.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps({'comparisons':len(output),'packedMaximumChannelDifference':max(x['maxChannelDifference'] for x in output if x['candidate']=='packed'),'surfaceMaximumFractionAbove8':max(x['fractionPixelsAbove8'] for x in output if x['candidate']=='surface')}))
