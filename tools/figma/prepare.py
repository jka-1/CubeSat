#!/usr/bin/env python3
"""Prepare one or more source-geometry snapshots for native Figma reconstruction."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAMES = {'home':'Home','communication':'I²C Telemetry','link-health':'Network Statistics','runs':'Logged Telemetry','twin':'Digital Twin','debug-mode':'Programming','sequences':'Branch Definition','manual':'Manual','partners':'Partners','account':'Account'}
parser=argparse.ArgumentParser()
parser.add_argument('--page',required=True)
parser.add_argument('--width',type=int,default=1440)
parser.add_argument('--start',type=int,default=0)
parser.add_argument('--data-only',action='store_true')
parser.add_argument('screens',nargs='+')
args=parser.parse_args()
styles=[]
screens=[]
for index,name in enumerate(args.screens,args.start):
    source=json.loads((ROOT/'documentation/design/figma/source-geometry'/f'{name}-{args.width}.json').read_text())
    nodes=[]
    def walk(n,parent=-1):
        css=n['css']
        mapping={'bg':'backgroundColor','c':'color','bc':'borderTopColor','bw':'borderTopWidth','rad':'borderRadius','fs':'fontSize','fw':'fontWeight','lh':'lineHeight','ls':'letterSpacing','ta':'textAlign','tt':'textTransform','op':'opacity','d':'display','dir':'flexDirection','gap':'gap','ov':'overflow','align':'alignItems','justify':'justifyContent'}
        style={k:css.get(v,'') for k,v in mapping.items()}
        style['pad']=[css.get('padding'+s,'0') for s in ['Top','Right','Bottom','Left']]
        if style not in styles:styles.append(style)
        item={k:v for k,v in n.items() if k not in ('children','css')}
        if 'image' in item:
            item.pop('image')
            item['imageHash'] = '04e0c988597a156b566180880f686cccb14ae6b3' if item['w'] > 600 else '53fff30598f892274d80fb0ed34324d1c24c482e'
        item.update(parent=parent,style=styles.index(style),parentX=nodes[parent]['x'] if parent >= 0 else 0,parentY=nodes[parent]['y'] if parent >= 0 else 0)
        pos=len(nodes);nodes.append(item)
        for c in n.get('children',[]):walk(c,pos)
    walk(source['tree'])
    route,_,detail=source['screen'].partition(':')
    label=NAMES.get(route,route)+((' / '+detail)if detail else '')
    height=max(source['tree']['h'], 900)
    # The viewport's blank lower region is useful context for short pages.
    screens.append({'name':f'{index+1:02d} · {label} · {args.width}', 'width':args.width,'height':height,'x':(index%3)*(args.width+180)+100,'y':(index//3)*2800+100,'nodes':nodes})
data={'pageId':args.page,'styles':styles,'screens':screens,'backgroundHash':'4dd029882b47b7fcc6645936f7b34ab3a817f83f','imageHashes':{'satellite.png':'2664952b4dfceadc860941ec10740f103569ce86'}}
if args.data_only:
    print(json.dumps(data,separators=(',',':')))
else:
    print('const DATA = '+json.dumps(data,separators=(',',':'))+';')
    print((ROOT/'tools/figma/build-native.js').read_text())
