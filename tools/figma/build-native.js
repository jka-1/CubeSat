// Prepend const DATA = <output of prepare.py>. Run with Figma use_figma.
const createdNodeIds=[], mutatedNodeIds=[], warnings=[];
const page=await figma.getNodeByIdAsync(DATA.pageId);
await figma.setCurrentPageAsync(page);
await Promise.all(['Regular','Bold','Italic','Bold Italic'].map(style=>figma.loadFontAsync({family:'Arimo',style})));
const colorVariables=await figma.variables.getLocalVariablesAsync('COLOR');
const sourceColors={'050505':'black','121212':'black-card','d4af37':'gold','f0d77a':'gold-soft','8f6a16':'gold-deep','ffffff':'white','ede8d9':'white-soft','54ef78':'success','ffd66b':'warning','ff7b7b':'danger','d2232a':'bus-red'};
function color(value){const m=String(value).match(/rgba?\(([^)]+)\)/);if(!m)return null;const v=m[1].split(',').map(Number);return {r:v[0]/255,g:v[1]/255,b:v[2]/255,a:v[3]??1};}
function paint(value){const c=color(value);if(!c||c.a<.001)return [];let p={type:'SOLID',color:{r:c.r,g:c.g,b:c.b},opacity:c.a};const hex=[c.r,c.g,c.b].map(n=>Math.round(n*255).toString(16).padStart(2,'0')).join('');const name=c.a<1?'opacity/'+[c.r,c.g,c.b].map(n=>Math.round(n*255)).join('-')+'/'+Math.round(c.a*1000):'color/'+sourceColors[hex];const v=colorVariables.find(v=>v.name===name);if(v)p=figma.variables.setBoundVariableForPaint(p,'color',v);return [p];}
function decode(s){const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let bits=0,value=0;const out=[];for(const c of s){const d=chars.indexOf(c);if(d<0)continue;value=(value<<6)|d;bits+=6;if(bits>=8){bits-=8;out.push((value>>bits)&255);}}return new Uint8Array(out);}
const imageHashes={...DATA.imageHashes};
const roots=[], nodeIds=[];
for(const spec of DATA.screens){
  const old=page.children.find(n=>n.name===spec.name);if(old&&!spec.wrapperId)throw new Error('Screen already exists: '+spec.name);
  const wrapper=spec.wrapperId?await figma.getNodeByIdAsync(spec.wrapperId):figma.createFrame();if(spec.wrapperId)mutatedNodeIds.push(wrapper.id);else createdNodeIds.push(wrapper.id);wrapper.name=spec.name;page.appendChild(wrapper);wrapper.resize(spec.width,spec.height);wrapper.x=spec.x;wrapper.y=spec.y;wrapper.clipsContent=true;
  wrapper.fills=[{type:'IMAGE',imageHash:DATA.backgroundHash,scaleMode:'FILL'},{type:'SOLID',color:{r:0,g:0,b:0},opacity:.87}];
  const made=[];
  for(let i=0;i<spec.nodes.length;i++){
    const r=spec.nodes[i],s=DATA.styles[r.style],parent=r.parentNodeId?await figma.getNodeByIdAsync(r.parentNodeId):r.parent<0?wrapper:made[r.parent];let n;
    if(r.tag==='TEXT'){
      n=figma.createText();n.fontName={family:'Arimo',style:(+s.fw>=600?'Bold':'Regular')};n.fontSize=Math.max(1,parseFloat(s.fs)||14);n.characters=s.tt==='uppercase'?r.text.toUpperCase():r.text;n.textAutoResize='HEIGHT';n.resize(Math.max(r.w+2,1),Math.max(r.h,1));const lh=parseFloat(s.lh);if(lh)n.lineHeight={unit:'PIXELS',value:lh};const ls=parseFloat(s.ls);if(ls)n.letterSpacing={unit:'PIXELS',value:ls};n.fills=paint(s.c);if(!n.fills.length)n.fills=paint('rgb(240,215,122)');if(r.h<n.fontSize*1.6)n.textAutoResize='WIDTH_AND_HEIGHT';
    }else if(r.svg){
      try{n=figma.createNodeFromSvg(r.svg);}catch(e){warnings.push('SVG '+r.name+': '+e.message);n=figma.createFrame();n.fills=[];}n.resize(Math.max(r.w,1),Math.max(r.h,1));
    }else{
      n=figma.createFrame();n.resize(Math.max(r.w,1),Math.max(r.h,1));n.clipsContent=['hidden','auto','scroll'].includes(s.ov);n.fills=paint(s.bg);n.cornerRadius=Math.max(0,parseFloat(s.rad)||0);const stroke=paint(s.bc),sw=parseFloat(s.bw);if(stroke.length&&sw){n.strokes=stroke;n.strokeWeight=sw;n.strokeAlign='INSIDE';}
      if(r.src){const hash=imageHashes[r.src]||imageHashes[r.src.split('/').pop()];if(hash)n.fills=[{type:'IMAGE',imageHash:hash,scaleMode:'FIT'}];}
      if(r.image){const key=r.image;const hash=imageHashes[key]||figma.createImage(decode(key.split(',')[1])).hash;imageHashes[key]=hash;n.fills=[{type:'IMAGE',imageHash:hash,scaleMode:'FILL'}];}
      if(r.imageHash)n.fills=[{type:'IMAGE',imageHash:r.imageHash,scaleMode:'FILL'}];
      if(r.tag==='BODY')n.fills=[];
    }
    createdNodeIds.push(n.id);if(r.svg&&'findAll'in n)createdNodeIds.push(...n.findAll(()=>true).map(c=>c.id));nodeIds.push(n.id);n.name=String(r.name||r.tag).slice(0,180);parent.appendChild(n);n.x=r.x-(r.parentX||0);n.y=r.y-(r.parentY||0);n.opacity=+s.op||1;made.push(n);
    if(r.text&&r.tag!=='TEXT'&&!['checkbox','radio'].includes(r.inputType)){
      const text=figma.createText();createdNodeIds.push(text.id);text.fontName={family:'Arimo',style:'Regular'};text.fontSize=parseFloat(s.fs)||14;text.characters=r.text;text.fills=paint(s.c);n.appendChild(text);text.textAutoResize='HEIGHT';text.resize(Math.max(1,r.w-24),Math.max(1,r.h-10));text.x=12;text.y=Math.max(4,(r.h-text.height)/2);
    }
  }
  const autoLayouts=0;
  roots.push({id:wrapper.id,name:wrapper.name,width:wrapper.width,height:wrapper.height,nodes:wrapper.findAll(()=>true).length,texts:wrapper.findAllWithCriteria({types:['TEXT']}).length,autoLayouts});
}
return {createdNodeIds,mutatedNodeIds,nodeIds,roots,warnings};
