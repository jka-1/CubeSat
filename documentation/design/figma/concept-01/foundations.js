const pageName='06 · New direction — Orbit / Workbench';
if(figma.root.children.some(p=>p.name===pageName)) return {existing:true,pages:figma.root.children.filter(p=>p.name===pageName).map(p=>({id:p.id,name:p.name}))};
const page=figma.createPage();page.name=pageName;await figma.setCurrentPageAsync(page);
const fonts=[['Manrope','Regular'],['Manrope','Medium'],['Manrope','SemiBold'],['Manrope','Bold'],['IBM Plex Mono','Regular'],['IBM Plex Mono','Medium'],['IBM Plex Serif','Light']];
await Promise.all(fonts.map(([family,style])=>figma.loadFontAsync({family,style})));
const created=[page.id],styles={},variables={};
const collection=figma.variables.createVariableCollection('KnightEPS concept 01 / Foundations');
const rgb=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const palette={canvas:'#0B1013',surface:'#12191D',raised:'#1A2328',line:'#303C42',text:'#F3F1EA',muted:'#ACB7BC',quiet:'#84949B',gold:'#FFC904',goldInk:'#19170D',green:'#A2D9B0',red:'#FFA59B',blue:'#9DC9E1',paper:'#E9E6DE',paperInk:'#202824'};
for(const [name,hex] of Object.entries(palette)){
 const primitive=figma.variables.createVariable('primitive/'+name,collection,'COLOR');primitive.scopes=[];primitive.setValueForMode(collection.defaultModeId,{...rgb(hex),a:1});primitive.setVariableCodeSyntax('WEB','var(--ke-'+name+')');
 const semantic=figma.variables.createVariable('color/'+name,collection,'COLOR');semantic.scopes=['FRAME_FILL','SHAPE_FILL','TEXT_FILL','STROKE_COLOR'];semantic.setValueForMode(collection.defaultModeId,{type:'VARIABLE_ALIAS',id:primitive.id});semantic.setVariableCodeSyntax('WEB','var(--ke-'+name+')');variables[name]=semantic.id;
}
for(const [name,value,scope] of [['space8',8,'GAP'],['space12',12,'GAP'],['space16',16,'GAP'],['space24',24,'GAP'],['radius8',8,'CORNER_RADIUS'],['radius12',12,'CORNER_RADIUS']]){
 const v=figma.variables.createVariable(name,collection,'FLOAT');v.scopes=[scope];v.setValueForMode(collection.defaultModeId,value);v.setVariableCodeSyntax('WEB','var(--ke-'+name+')');variables[name]=v.id;
}
for(const [name,family,style,size,line] of [['Display','IBM Plex Serif','Light',96,94],['Page','Manrope','Medium',32,40],['Section','Manrope','SemiBold',18,26],['Body','Manrope','Regular',14,22],['Label','Manrope','SemiBold',13,20],['Small','Manrope','Regular',12,18],['Data','IBM Plex Mono','Regular',13,20],['Metric','Manrope','Medium',32,40]]){
 const s=figma.createTextStyle();s.name='KnightEPS 01 / '+name;s.fontName={family,style};s.fontSize=size;s.lineHeight={unit:'PIXELS',value:line};styles[name]=s.id;
}
const vars={};for(const [k,v] of Object.entries(variables))vars[k]=await figma.variables.getVariableByIdAsync(v);
const paint=k=>figma.variables.setBoundVariableForPaint({type:'SOLID',color:rgb(palette[k])},'color',vars[k]);
const variants=[];
// Adapted from the skill's createComponentWithVariants helper: one page switch above.
for(const kind of ['Primary','Secondary','Quiet'])for(const state of ['Default','Hover','Focus','Disabled']){
 const c=figma.createComponent();c.name='Style='+kind+', State='+state;c.layoutMode='HORIZONTAL';c.resize(168,44);c.primaryAxisAlignItems='CENTER';c.counterAxisAlignItems='CENTER';c.paddingLeft=16;c.paddingRight=16;c.itemSpacing=8;c.cornerRadius=8;c.fills=kind==='Primary'?[paint('gold')]:kind==='Quiet'?[]:[paint(state==='Hover'?'raised':'surface')];
 if(kind==='Secondary'||state==='Focus'){c.strokes=[paint(state==='Focus'?'gold':'line')];c.strokeWeight=state==='Focus'?2:1;}
 c.setBoundVariable('paddingLeft',vars.space16);c.setBoundVariable('paddingRight',vars.space16);c.setBoundVariable('itemSpacing',vars.space8);c.setBoundVariable('cornerRadius',vars.radius8);
 if(state==='Disabled')c.opacity=.4;
 const t=figma.createText();t.name='Label — edit me';await t.setTextStyleIdAsync(styles.Label);t.characters='Open dashboard';t.fills=[paint(kind==='Primary'?'goldInk':'text')];c.appendChild(t);const prop=c.addComponentProperty('Label','TEXT','Open dashboard');t.componentPropertyReferences={characters:prop};
 c.description='Editable action label. Choose Style and State in the properties panel. Focus and disabled states are visual specifications.';page.appendChild(c);variants.push(c);created.push(c.id,t.id);
}
const set=figma.combineAsVariants(variants,page);set.name='KnightEPS 01 / Button';set.x=80;set.y=2800;set.description='Local editable controls for concept review. Use Label, Style and State properties.';set.fills=[paint('canvas')];set.resize(780,260);variants.forEach((c,i)=>{c.x=20+(i%4)*188;c.y=28+Math.floor(i/4)*76});created.push(set.id);
return {pageId:page.id,createdNodeIds:created,collectionId:collection.id,variables,styles,buttonSetId:set.id,buttons:variants.map(c=>({id:c.id,name:c.name})),palette};
