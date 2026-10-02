import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { cpus, totalmem, tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import mqtt from 'mqtt'
const require=createRequire(import.meta.url)
const runtime=process.env.STRESS_NODE_PACKAGES || join(tmpdir(),'aion2web-load-runtime','node_modules')
const aedes=require(join(runtime,'aedes'))
const websocket=require(join(runtime,'websocket-stream'))
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const python=process.env.STRESS_PYTHON
if (!python) throw new Error('Set STRESS_PYTHON to a Python executable')
const fixture=`
import {createRoot} from 'react-dom/client'; import {useEffect} from 'react';
import {useAionConsole} from './src/lib/use-aion-console';
window.latencies=[];window.seen=new Set();window.longTasks=[];window.pageErrors=[];
new PerformanceObserver(list=>{for(const e of list.getEntries())window.longTasks.push(e.duration)}).observe({type:'longtask',buffered:true});
function App(){ const api=useAionConsole();
useEffect(()=>{window.api=api;for(const m of api.inboxMessages){if(window.seen.has(m.id))break;if(m.raw.loadSentAt){window.seen.add(m.id);window.latencies.push(Date.now()-m.raw.loadSentAt)}}},[api]);
return <><input aria-label="typing"/><p>{api.connectionState} · {api.agents.length} clients · {api.inboxMessages.length} replies</p>{api.inboxMessages.slice(0,20).map(m=><div key={m.id}>{m.content}</div>)}</>}
createRoot(document.getElementById('root')).render(<App/>);`
const bundle=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'#':join(process.cwd(),'src')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const summary=v=>{const a=[...v].sort((a,b)=>a-b); const pct=p=>a.length?Math.round(a[Math.min(a.length-1,Math.ceil(p*a.length)-1)]*10)/10:null;return {count:a.length,p50:pct(.5),p95:pct(.95),p99:pct(.99),max:pct(1)}}
const clientSource=process.env.STRESS_CLIENT_SOURCE || 'E:/project/aion2/client/mitm_ws_message_monitor.py'
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
const report={at:new Date().toISOString(),clientSource,clientSha256:hash(clientSource),consoleSha256:hash('src/lib/use-aion-console.ts'),gameDelayMs:Number(process.env.STRESS_GAME_DELAY_MS||20),machine:{cpu:cpus()[0].model,logicalCpus:cpus().length,ramGB:Math.round(totalmem()/2**30)},scope:'Loopback Aedes broker + real Python MQTT relay/Paho + real browser useAionConsole. Game HTTP replaced with fixed-delay success (gameDelayMs); mitmproxy host stubbed. No game, public broker, production API/DB, AI, account authorization, or full console page load.',stages:[]}
mkdirSync('artifacts',{recursive:true})
const output=process.env.STRESS_REPORT || 'artifacts/client-console-stress.json'
const stages=process.env.STRESS_STAGES ? JSON.parse(process.env.STRESS_STAGES) : [[10,2,1,10],[50,5,1,15],[100,5,2,15],[200,5,2,15]]
for(const [clients,consoles,rate,seconds] of stages){
 const broker=aedes();const http=createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text)}
  else if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,locks:[]}))}
  else {res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>')}
 });
 const ws=websocket.createServer({server:http,perMessageDeflate:false},broker.handle)
 await new Promise(r=>http.listen(0,'127.0.0.1',r)); const port=http.address().port
 const tcp=(await import('node:net')).createServer(broker.handle);await new Promise(r=>tcp.listen(0,'127.0.0.1',r))
 let browser,child,contexts=[], probe;const errors=[], queue=[], waiters=[];let rawChat=0
 broker.on('publish',(packet,client)=>{if(client&&packet.topic.includes('/events/')){try{if(JSON.parse(packet.payload).type==='chat_message')rawChat++}catch{}}})
 const next=()=>new Promise((resolve,reject)=>{if(queue.length)return resolve(queue.shift());const timer=setTimeout(()=>reject(new Error('Python relay response timeout')),60000);waiters.push(v=>{clearTimeout(timer);resolve(v)})})
 const send=async data=>{child.stdin.write(JSON.stringify(data)+'\n');return next()}
 console.log(JSON.stringify({starting:{clients,consoles,rate,seconds}}))
 try{
  browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
  const pages=[]
  for(let i=0;i<consoles;i++){
   const context=await browser.newContext();contexts.push(context)
   await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'?route.continue():route.abort()})
   await context.addInitScript(({port})=>{localStorage.setItem('aion2-mqtt-url','ws://127.0.0.1:'+port);localStorage.setItem('aion2-room','isolated');localStorage.setItem('aion2-prefix','stress')},{port})
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));pages.push(page);await page.goto('http://127.0.0.1:'+port)
   await page.waitForFunction(()=>window.api?.connectionState==='connected')
  }
  child=spawn(python,['-B','scripts/stress-client-relays.py',process.env.STRESS_CLIENT_SOURCE||'E:/project/aion2/client/mitm_ws_message_monitor.py',String(tcp.address().port),String(clients)],{env:{...process.env,STRESS_PYTHON_PACKAGES:process.env.STRESS_PYTHON_PACKAGES||join(tmpdir(),'aion2web-load-python')},windowsHide:true,stdio:['pipe','pipe','pipe']})
  child.stderr.on('data',b=>errors.push(b.toString().slice(0,1000)))
  createInterface({input:child.stdout}).on('line',line=>{try{const v=JSON.parse(line);if(waiters.length)waiters.shift()(v);else queue.push(v)}catch{}})
  const ready=await next();if(ready.ready!==clients)throw new Error('Not all relays connected: '+JSON.stringify(ready))
  await Promise.all(pages.map(p=>p.waitForFunction(n=>window.api.agents.length===n,clients)))
  await Promise.all(pages.map(p=>p.evaluate(()=>{window.longTasks=[]})))
  const begun=Date.now();const traffic=send({action:'traffic',rate,seconds})
  const commands=await Promise.all(pages.map((page,consoleIndex)=>page.evaluate(async({clients,seconds,consoleIndex})=>{
   const samples=[],statuses={};let sequence=0;const end=performance.now()+seconds*1000;
   while(performance.now()<end){await Promise.all(Array.from({length:5},async()=>{const i=sequence++;const start=performance.now();const r=await window.api.sendCommandWithReceipt('load-'+((consoleIndex*5+i)%clients),{type:'sendWhisper',characterId:'fixture',serverKey:'1001',content:'isolated load '+i});samples.push(performance.now()-start);statuses[r.status]=(statuses[r.status]||0)+1}));await new Promise(r=>setTimeout(r,250))}
   return {samples,statuses}
  },{clients,seconds,consoleIndex})))
  const generated=await traffic;const expected=generated.traffic
  let drained=true
  for(const page of pages){try{await page.waitForFunction(n=>window.api.inboxMessages.length>=n,expected,{timeout:10000})}catch{drained=false}}
  const browserStats=await Promise.all(pages.map(p=>p.evaluate(()=>({received:window.api.inboxMessages.length,measured:window.seen.size,latencies:window.latencies,longTasks:window.longTasks,heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/2**20):null,agents:window.api.agents.length}))))
  const stats=await send({action:'stats'});const offline=await send({action:'offline_probe'});const replay=await send({action:'replay_probe'})
  probe=await mqtt.connectAsync('mqtt://127.0.0.1:'+tcp.address().port,{reconnectPeriod:0});const duplicate={type:'sendWhisper',target:'load-0',requestId:'duplicate-probe',characterId:'fixture',content:'duplicate probe'}
  await probe.publishAsync('stress/isolated/control/agent/load-0',JSON.stringify(duplicate));await probe.publishAsync('stress/isolated/control/agent/load-0',JSON.stringify(duplicate));await new Promise(r=>setTimeout(r,Math.max(500,report.gameDelayMs*2+250)))
  const after=await send({action:'stats'})
  const statuses={};for(const c of commands)for(const[k,v]of Object.entries(c.statuses))statuses[k]=(statuses[k]||0)+v
  const stage={clients,consoles,messagesPerClientPerSecond:rate,trafficSeconds:seconds,elapsedSeconds:(Date.now()-begun)/1000,generated:expected,brokerReceivedChat:rawChat,expectedDeliveries:expected*consoles,receivedDeliveries:browserStats.reduce((s,b)=>s+b.received,0),drained,chatLatencyMs:summary(browserStats.flatMap(b=>b.latencies)),commandLatencyMs:summary(commands.flatMap(c=>c.samples)),commandStatuses:statuses,clientStats:stats,longTasks:summary(browserStats.flatMap(b=>b.longTasks)),browserHeapMB:browserStats.map(b=>b.heapMB),offlineQueueProbe:offline,duplicateExecutions:after.executed-stats.executed,errors}
  stage.eventReplayProbe=replay
  const burstCount=Number(process.env.STRESS_BURST_PER_CONSOLE || 0)
  if(burstCount){
   const beforeBurst=await send({action:'stats'})
   const burstResults=(await Promise.all(pages.map(page=>page.evaluate(async count=>
    Promise.all(Array.from({length:count},(_,i)=>window.api.sendCommandWithReceipt('load-0',{
     type:'sendWhisper',characterId:'fixture',content:'bounded queue burst '+i
    }))),burstCount)))).flat()
   const afterBurst=await send({action:'stats'}),burstStatuses={}
   for(const result of burstResults)burstStatuses[result.status]=(burstStatuses[result.status]||0)+1
   stage.overloadProbe={submitted:burstCount*consoles,statuses:burstStatuses,
    executed:afterBurst.executed-beforeBurst.executed,activeAfter:afterBurst.active,
    maxActiveGameCalls:afterBurst.maxActiveGameCalls}
   if(burstStatuses.unknown||burstStatuses.failed||!burstStatuses.not_sent||
    afterBurst.executed-beforeBurst.executed!==(burstStatuses.confirmed||0)||afterBurst.active)process.exitCode=1
  }
  report.stages.push(stage);console.log(JSON.stringify(stage));writeFileSync(output,JSON.stringify(report,null,2))
  if(!drained||errors.length||statuses.unknown||statuses.failed||statuses.not_sent){process.exitCode=1;break}
 }catch(e){report.stages.push({clients,consoles,error:String(e),errors});writeFileSync(output,JSON.stringify(report,null,2));console.error(e);process.exitCode=1;break}
 finally{
  if(probe)await probe.endAsync(true)
  if(child){child.stdin.write('{"action":"stop"}\n');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill()}
  if(browser)await browser.close();ws.close();await new Promise(r=>broker.close(r));http.closeAllConnections();await new Promise(r=>http.close(r));await new Promise(r=>tcp.close(r))
 }
}
