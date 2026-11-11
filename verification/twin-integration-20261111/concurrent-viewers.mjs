// Real bridge, nine independent viewer sessions, loopback only. No commands,
// device traffic, production credentials or production server are involved.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import dgram from 'node:dgram';
import {passwordRecord} from '../../telemetry-bridge/auth/session.mjs';
async function port(udp=false){const socket=udp?dgram.createSocket('udp4'):net.createServer();udp?socket.bind(0,'127.0.0.1'):socket.listen(0,'127.0.0.1');await once(socket,'listening');const n=socket.address().port;await new Promise(r=>socket.close(r));return n}
const directory=await mkdtemp(join(tmpdir(),'knight-nine-viewers-')),http=await port(),udp=await port(true),origin=`http://127.0.0.1:${http}`;
const password='isolated-fixture-only',config=join(directory,'auth.json');
await writeFile(config,JSON.stringify({key:randomBytes(32).toString('hex'),users:[{username:'viewer',role:'viewer',...await passwordRecord(password)}]}),{mode:0o600});
const bridge=spawn(process.execPath,[fileURLToPath(new URL('../../telemetry-bridge/server.js',import.meta.url))],{env:{PATH:process.env.PATH,HOME:directory,TMPDIR:directory,AUTH_CONFIG_PATH:config,AUTH_ORIGIN:origin,AUTH_ALLOW_LOCAL_HTTP:'true',HTTP_PORT:String(http),UDP_PORT:String(udp),HTTP_BIND_ADDRESS:'127.0.0.1',UDP_BIND_ADDRESS:'127.0.0.1',COMMAND_TOKEN:'isolated-fixture-only',RECORDING_DB_PATH:join(directory,'runs.sqlite')},stdio:['ignore','pipe','pipe']});
let log='';bridge.stdout.on('data',b=>log+=b);bridge.stderr.on('data',b=>log+=b);
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),streams=[],observations=Array.from({length:9},()=>[]),start=performance.now();
async function until(check){for(let n=0;n<150;n++){if(await check())return;await sleep(20)}throw Error('Timed out: '+log)}
try{
 await until(async()=>{try{return (await fetch(origin+'/auth/status')).ok}catch{return false}});
 const cookies=[];
 for(let n=0;n<9;n++){
  const login=await fetch(origin+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'viewer',password})});assert.equal(login.status,200);cookies.push(login.headers.get('set-cookie').split(';')[0]);
 }
 const readers=await Promise.all(cookies.map(async(cookie,i)=>{
  const controller=new AbortController();streams.push(controller);
  const response=await fetch(origin+'/public/events',{headers:{Cookie:cookie},signal:controller.signal});assert.equal(response.status,200);
  const reader=response.body.getReader();const reading=(async()=>{let buffer='';try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(value);const blocks=buffer.split('\n\n');buffer=blocks.pop();for(const block of blocks)if(block.startsWith('data: '))observations[i].push(JSON.parse(block.slice(6)))}}catch(error){if(error.name!=='AbortError')throw error}})();
  return {reading};
 }));
 await until(()=>observations.every(events=>events.some(e=>e.type==='status'&&e.web_clients===9)));
 const health=await fetch(origin+'/public/health',{headers:{Cookie:cookies[0]}}).then(r=>r.json());assert.equal(health.web_clients,9);
 for(const controller of streams.splice(0,3))controller.abort();
 await until(()=>observations.filter((_,i)=>i>=3).every(events=>events.some(e=>e.type==='status'&&e.web_clients===6)));
 const report={sessions:9,concurrentStreams:9,allReceivedFanout:true,remainingAfterThreeClose:6,elapsedMs:performance.now()-start,hardwareTraffic:false,productionTest:false};
 for(const controller of streams)controller.abort();await Promise.all(readers.map(r=>r.reading));
 await until(async()=>{const health=await fetch(origin+'/public/health',{headers:{Cookie:cookies[0]}}).then(r=>r.json());return health.web_clients===0});
 report.streamsAfterCleanup=0;await writeFile(new URL('./results/concurrent-viewers.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
 for(const controller of streams)controller.abort();if(bridge.exitCode===null){const ended=once(bridge,'exit');bridge.kill('SIGTERM');await ended}await rm(directory,{recursive:true,force:true});
}
