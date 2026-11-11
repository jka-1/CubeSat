"""Reuse the established UI/controller as a compatibility harness, not a rewrite.
Only writes this prototype. Renderer/material/asset experiments remain separate.
"""
from pathlib import Path
import json, hashlib
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
VIEW=ROOT/'site/knight-eps-phase12/viewer'
s=(VIEW/'main.mjs').read_text()
s=s.replace('requestAnimationFrame(', 'requestRenderTick(').replace('cancelAnimationFrame(', 'cancelRenderTick(')
s=s.replace('const frameStart=performance.now();','const frameStart=performance.now();renderer.__prototypeFrameStart=frameStart;')
s=s.replace('metrics.cpuFrameMs=performance.now()-frameStart;','metrics.cpuFrameMs=performance.now()-frameStart;renderer.__prototypeFrameStart=null;')
s="import {requestRenderTick,cancelRenderTick} from './render-clock.mjs';\n"+s
s="import {loadModel,prepareModel,applyCostDiagnostic} from './model-loader.mjs';\nimport {createRenderer,installRenderer,createFloorMaterial} from './renderer-adapter.mjs';\n"+s
s=s.replace("from './", "from '/site/knight-eps-phase12/viewer/")
# Keep newly introduced modules local.
for module in ['renderer-adapter','model-loader','render-clock']:s=s.replace("from '/site/knight-eps-phase12/viewer/"+module+".mjs'", "from './"+module+".mjs'")
s=s.replace('new THREE.WebGLRenderer({antialias:true,alpha:false,logarithmicDepthBuffer:true})','await createRenderer()')
s=s.replace("Math.min(devicePixelRatio||1,quality==='studio'?2:1)","(quality==='studio'?2:1)")
s=s.replace("new URL('../models/KnightEPS_Detailed.glb',import.meta.url)","new URL('/site/knight-eps-phase12/models/KnightEPS_Detailed.glb',location.href)")
s=s.replace("new URL('../docs/component_manifest.json',import.meta.url)","new URL('/site/knight-eps-phase12/docs/component_manifest.json',location.href)")
s=s.replace('const controlsChanged=!cameraTransition&&controls.update()','const controlsChanged=!cameraTransition&&controls.update(dt)')
s=s.replace('drawCalls:renderer.info.render.calls','drawCalls:renderer.info.render.drawCalls??renderer.info.render.calls')
s=s.replace("loaded=true;invalidate(","installRenderer({renderer,scene,camera,controls,api,parts:meshes,display,model,clearSelection:()=>select(null),releaseController:()=>{baseMaterials.clear();materialVariants.clear();initial.clear();assemblyVectors.clear();for(const key of Object.keys(coverPivots))delete coverPivots[key];instances=null;studioFloor=null;meshes.length=0;selected=null;model=null}});loaded=true;invalidate(")
s=s.replace('new THREE.ShadowMaterial({opacity:.14})','createFloorMaterial(lamp)')
s=s.replace('floor.receiveShadow=true;',"floor.name='Prototype_ShadowFloor';floor.receiveShadow=true;if(renderer.backend)floor.visible=quality==='studio';")
s=s.replace("quality=value;qs('#quality')","quality=value;if(renderer.backend&&studioFloor)studioFloor.visible=value==='studio';qs('#quality')")
s=s.replace('new GLTFLoader().loadAsync(url.href)','loadModel(url.href)')
s=s.replace('metrics.materials=deduplicateMaterials(model);metrics.consolidation={};','metrics.materials=deduplicateMaterials(model);metrics.consolidation={};prepareModel(model);applyCostDiagnostic(model);')
s=s.replace('metrics.consolidation[id]=consolidateComponent(obj,metadata.display.mesh_name);',"metrics.consolidation[id]=new URLSearchParams(location.search).get('asset')&&new URLSearchParams(location.search).get('asset')!=='original'?{offline:true}:consolidateComponent(obj,metadata.display.mesh_name);")
(HERE/'boot.mjs').write_text(s)
html=(VIEW/'index.html').read_text().replace('href="styles.css?v=20261109a"','href="/site/knight-eps-phase12/viewer/styles.css?v=20261109a"')
start=html.index('<script type="importmap">');end=html.index('</script>',start)+9
html=html[:start]+'<!--IMPORTMAP-->'+html[end:]
html=html.replace('src="main.mjs?v=20261109a"','src="boot.mjs"')
(HERE/'index.html').write_text(html)
files=[VIEW/'main.mjs',VIEW/'display.mjs',VIEW/'render-optimizations.mjs',ROOT/'site/knight-eps-phase12/models/KnightEPS_Detailed.glb']
provenance={'sourceFiles':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files},'three':{'version':'0.176.0','url':'https://registry.npmjs.org/three/-/three-0.176.0.tgz','files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (HERE/'vendor/three-r176').iterdir()}}}
(HERE/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print('Generated compatibility harness and provenance; production files untouched.')
