import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverLegacyDashboard} from '../../site/knight-eps-phase12/viewer/dashboard-integration.mjs';

function dashboard(href='https://example.com/site/?existing=1#twin'){
 const navigations=[],frame={};
 const parent={document:{getElementById:()=>frame},location:{href,replace:url=>navigations.push(url)}};
 return {win:{parent,frameElement:frame,location:{origin:'https://example.com'}},navigations};
}
test('a legacy live adapter refreshes its dashboard and preserves its route and query',()=>{
 const {win,navigations}=dashboard();
 assert.equal(recoverLegacyDashboard(win,{source:'live'}),'refreshing');
 assert.deepEqual(navigations,['https://example.com/site/?existing=1&twinTelemetry=20261111-sync#twin']);
 for(let i=0;i<20;i++)assert.equal(recoverLegacyDashboard(win,{source:'live'}),'refreshing');
 assert.equal(navigations.length,1,'a fast packet stream must not keep restarting the pending navigation');
});
test('current complete snapshots and mock updates never refresh',()=>{
 const {win,navigations}=dashboard();
 for(const options of [{source:'live',snapshot:true},{source:'mock'},{}])assert.equal(recoverLegacyDashboard(win,options),null);
 assert.deepEqual(navigations,[]);
});
test('a still-legacy deployment is blocked after one refresh instead of looping',()=>{
 const {win,navigations}=dashboard('https://example.com/site/?twinTelemetry=20261111-sync#twin');
 assert.equal(recoverLegacyDashboard(win,{source:'live'}),'blocked');assert.deepEqual(navigations,[]);
});
test('standalone public live integrations remain compatible',()=>{
 const win={};win.parent=win;
 assert.equal(recoverLegacyDashboard(win,{source:'live'}),null);
});
test('unrelated embeddings and dashboard routes cannot trigger navigation',()=>{
 const a=dashboard();a.win.parent.document.getElementById=()=>({});
 const b=dashboard('https://example.com/site/#communication');
 const c=dashboard('https://another.example/site/#twin');
 for(const {win,navigations} of [a,b,c]){assert.equal(recoverLegacyDashboard(win,{source:'live'}),null);assert.deepEqual(navigations,[])}
});
test('cross-origin parent access is ignored safely',()=>{
 const {win}=dashboard();Object.defineProperty(win.parent,'document',{get(){throw Error('Cross origin')}});
 assert.equal(recoverLegacyDashboard(win,{source:'live'}),null);
});
test('a blocked navigation cannot accept the old partial feed as fresh',()=>{
 const {win}=dashboard();win.parent.location.replace=()=>{throw Error('Navigation blocked')};
 assert.equal(recoverLegacyDashboard(win,{source:'live'}),'blocked');
});
