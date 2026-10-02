import { createRequire } from 'node:module'
import { fork, spawn } from 'node:child_process'
import { createServer as httpServer } from 'node:http'
import { createServer as tcpServer } from 'node:net'
import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync } from 'node:fs'
import { cpus, totalmem, freemem, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import mqtt from 'mqtt'

const require = createRequire(import.meta.url), mode = process.argv[2]
const runtime = join(tmpdir(), 'aion2web-load-runtime/node_modules')
const resources = []
let prevCpu = process.cpuUsage(), prevTime = performance.now()
const sampler = setInterval(() => {
  const now = performance.now(), cpu = process.cpuUsage()
  resources.push({ at: Date.now(), rssMB: Math.round(process.memoryUsage().rss / 2**20),
    freeGiB: Math.round(freemem()/2**30*100)/100,
    cpuOneCorePercent: Math.round((cpu.user+cpu.system-prevCpu.user-prevCpu.system)/(now-prevTime)/10),
    timerLagMs: Math.max(0, Math.round(now-prevTime-1000)) })
  prevCpu = cpu; prevTime = now
}, 1000)
sampler.unref()
const histogram = () => ({ count: 0, max: 0, buckets: {} })
function record(h, value) { const n = Math.max(0, Math.ceil(value)); h.count++; h.max = Math.max(h.max,n); h.buckets[n] = (h.buckets[n]||0)+1 }
function summarize(h) {
  const entries = Object.entries(h.buckets).map(([k,v])=>[Number(k),v]).sort((a,b)=>a[0]-b[0])
  const percentile = p => {let count=0; for(const [k,v] of entries){count+=v;if(count>=Math.ceil(h.count*p))return k}return null}
  return { count:h.count,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),max:h.max }
}
function merge(histograms) { const h=histogram();for(const item of histograms){h.count+=item.count;h.max=Math.max(h.max,item.max);for(const[k,v]of Object.entries(item.buckets))h.buckets[k]=(h.buckets[k]||0)+v}return h }
const delay = ms => new Promise(r=>setTimeout(r,ms))

if (mode === 'broker') {
  const broker = require(join(runtime,'aedes'))(), server=httpServer(), tcp=tcpServer(broker.handle)
  const ws = require(join(runtime,'websocket-stream')).createServer({server,perMessageDeflate:false},broker.handle)
  let connected=0,peak=0,disconnects=0,stage='',chat=0,bytes=0,controls=0,latency=histogram()
  broker.on('clientReady',()=>{connected++;peak=Math.max(peak,connected)})
  broker.on('clientDisconnect',()=>{connected--;disconnects++})
  broker.on('publish',(packet,client)=>{
    if(!client)return
    try{const value=JSON.parse(packet.payload);if(value.type==='chat_message'&&value.loadStage===stage){chat++;bytes+=packet.payload.length;record(latency,Date.now()-value.loadSentAt)}
      if(value.type==='sendWhisper')controls++
    }catch{}
  })
  process.on('message',async ({id,action,data})=>{
    try{
      let result
      if(action==='start'){await new Promise(r=>server.listen(0,'127.0.0.1',r));await new Promise(r=>tcp.listen(0,'127.0.0.1',r));result={wsPort:server.address().port,tcpPort:tcp.address().port}}
      if(action==='stage'){stage=data.stage;chat=0;bytes=0;latency=histogram();result={ok:true}}
      if(action==='stats')result={connected,peak,disconnects,chat,bytes,controls,latency,resources}
      process.send({reply:id,result})
    }catch(error){process.send({reply:id,error:String(error)})}
  })
} else if (mode === 'subscriber') {
  const clients=[], states=[], pending=new Map(), errors=[]
  let stage='',received=0,duplicates=0,outOfOrder=0,reconnects=0,latency=histogram()
  process.on('message',async ({id,action,data})=>{
    try{
      let result
      if(action==='start'){
        for(let offset=0;offset<data.count;offset+=10)await Promise.all(Array.from({length:Math.min(10,data.count-offset)},async(_,j)=>{
          const state={index:data.offset+offset+j,seen:new Set(),received:0,last:-1};states.push(state)
          const client=mqtt.connect('ws://127.0.0.1:'+data.port,{clientId:'sim-'+state.index,reconnectPeriod:1000,connectTimeout:20000})
          clients.push(client);state.client=client
          client.on('error',e=>{if(errors.length<20)errors.push(e.message)})
          client.on('reconnect',()=>reconnects++)
          client.on('message',(_,buffer)=>{
            let value;try{value=JSON.parse(buffer)}catch{return}
            if(value.type==='control_result'){
              const entry=pending.get(value.requestId)
              if(entry&&entry.client===client){pending.delete(value.requestId);clearTimeout(entry.timer);entry.resolve({status:value.status||(value.ok?'confirmed':'failed'),ms:Date.now()-entry.started,publishedAt:entry.started})}
            }
            if(value.type!=='chat_message'||value.loadStage!==stage)return
            if(state.seen.has(value.message_id)){duplicates++;return}
            state.seen.add(value.message_id);state.received++;received++
            if(value.loadIndex<state.last)outOfOrder++;state.last=value.loadIndex
            record(latency,Date.now()-value.loadSentAt)
          })
          await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('error',reject)})
          await client.subscribeAsync(['stress/isolated/agents/+/status','stress/isolated/events/+/chat'])
          await client.publishAsync('stress/isolated/signal/agent/all',JSON.stringify({type:'discover',sender:'sim-'+state.index,target:'all'}))
        }))
        result={connected:clients.filter(c=>c.connected).length}
      }
      if(action==='stage'){stage=data.stage;received=0;duplicates=0;outOfOrder=0;latency=histogram();for(const s of states){s.seen.clear();s.received=0;s.last=-1}result={ok:true}}
      if(action==='stats')result={connected:clients.filter(c=>c.connected).length,received,duplicates,outOfOrder,reconnects,perConsole:states.map(s=>s.received),latency,errors,resources}
      if(action==='burst'){
        await delay(Math.max(0,data.startAt-Date.now()))
        result=await Promise.all(clients.map(client=>new Promise(resolve=>{
          const requestId=randomUUID(),started=Date.now()
          const timer=setTimeout(()=>{pending.delete(requestId);resolve({status:'unknown',ms:Date.now()-started,publishedAt:started})},45000)
          pending.set(requestId,{client,resolve,timer,started})
          client.publish('stress/isolated/control/agent/load-0',JSON.stringify({type:'sendWhisper',requestId,target:'load-0',characterId:'fixture',content:'isolated 1000-console burst',expiresAt:started+30000}))
        })))
      }
      process.send({reply:id,result})
    }catch(error){process.send({reply:id,error:String(error)})}
  })
} else {
  const {build}=await import('esbuild')
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
  const source=process.env.STRESS_CLIENT_SOURCE||'E:/project/aion2/client/mitm_ws_message_monitor.py'
  const python=process.env.STRESS_PYTHON||'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
  const total=Number(process.env.CONSOLES||1000),browserCount=Number(process.env.BROWSER_CONSOLES||20)
  const stages=JSON.parse(process.env.CHAT_STAGES||'[[10,120],[50,60],[100,30]]')
  const reportFile=process.env.STRESS_REPORT||'artifacts/single-client-1000-consoles.json'
  const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
  const report={at:new Date().toISOString(),machine:{cpu:cpus()[0].model,cores:cpus().length,totalGiB:totalmem()/2**30,freeGiBAtStart:freemem()/2**30},
    clients:1,consoles:total,browserConsoles:browserCount,protocolConsoles:total-browserCount,clientSha256:hash(source),consoleSha256:hash('src/lib/use-aion-console.ts'),
    gameDelayMs:500,stages:[],scope:'Real MQTT-only Python relay with mitmproxy host stub; local Aedes in a separate process; independent MQTT.js WebSocket connections across 10 load processes and 20 real Edge hook fixtures. Game execution is simulated at 500ms. No public broker, production DB, AI, business locks, real game or full UI.'}
  const children=[],errors=[],rpcs=new Map();let rpcSequence=0,browser,web,pythonChild,pythonExit,brokerStats,workerStats=[]
  const save=()=>writeFileSync(reportFile,JSON.stringify(report,null,2))
  function child(role){const c=fork(fileURLToPath(import.meta.url),[role],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});children.push(c)
    c.stderr.on('data',b=>{if(errors.length<30)errors.push({role,message:b.toString().slice(0,1000)})})
    c.on('message',m=>{const pending=rpcs.get(m.reply);if(pending){clearTimeout(pending.timer);rpcs.delete(m.reply);m.error?pending.reject(new Error(m.error)):pending.resolve(m.result)}})
    c.on('exit',(code,signal)=>{for(const[id,p]of rpcs)if(p.child===c){clearTimeout(p.timer);rpcs.delete(id);p.reject(new Error(role+' exited '+code+' '+signal))}})
    return c}
  const rpc=(child,action,data={})=>new Promise((resolve,reject)=>{const id=++rpcSequence;const timer=setTimeout(()=>{rpcs.delete(id);reject(new Error(action+' RPC timeout'))},120000);rpcs.set(id,{child,resolve,reject,timer});child.send({id,action,data})})
  const pages=[],workers=[];let abortReason=''
  const guard=setInterval(()=>{if(freemem()<2.5*2**30){abortReason='Free memory below 2.5 GiB';if(pythonChild)pythonChild.kill()}},2000)
  try{
    const broker=child('broker'),ports=await rpc(broker,'start')
    const fixture=`import{createRoot}from'react-dom/client';import{useEffect}from'react';import{useAionConsole}from'./src/lib/use-aion-console';
      window.stats={stage:'',seen:new Set(),latencies:[],longTasks:[]};new PerformanceObserver(list=>{window.stats.longTasks.push(...list.getEntries().map(e=>e.duration))}).observe({type:'longtask',buffered:true});
      function App(){const api=useAionConsole();useEffect(()=>{window.api=api;for(const m of api.inboxMessages){if(m.raw.loadStage!==window.stats.stage)break;if(window.stats.seen.has(m.id))break;window.stats.seen.add(m.id);window.stats.latencies.push(Date.now()-m.raw.loadSentAt)}},[api]);return <><p>{api.connectionState} {api.inboxMessages.length}</p>{api.inboxMessages.slice(0,20).map(m=><div key={m.id}>{m.content}</div>)}</>}createRoot(document.getElementById('root')).render(<App/>);`
    const bundle=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'#':join(process.cwd(),'src')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
    web=httpServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text)}else{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>')}})
    await new Promise(r=>web.listen(0,'127.0.0.1',r))
    browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
    for(let i=0;i<browserCount;i++){
      const context=await browser.newContext()
      await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
      await context.addInitScript(port=>{localStorage.setItem('aion2-mqtt-url','ws://127.0.0.1:'+port);localStorage.setItem('aion2-room','isolated');localStorage.setItem('aion2-prefix','stress')},ports.wsPort)
      const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push({role:'browser',message:e.message}))
      await page.goto('http://127.0.0.1:'+web.address().port);await page.waitForFunction(()=>window.api?.connectionState==='connected')
    }
    console.log(JSON.stringify({phase:'browser consoles connected',count:pages.length}))
    const workerCount=Math.min(10,total-browserCount)
    for(let i=0,offset=0;i<workerCount;i++){const count=Math.floor((total-browserCount)/workerCount)+(i<(total-browserCount)%workerCount?1:0);const w=child('subscriber');workers.push({child:w,offset,count});offset+=count}
    const started=await Promise.all(workers.map(w=>rpc(w.child,'start',{port:ports.wsPort,count:w.count,offset:w.offset})))
    report.subscriberConnections=started.reduce((n,r)=>n+r.connected,0)+pages.length
    if(report.subscriberConnections!==total)throw new Error('Subscriber count mismatch')
    const queue=[],waiting=[]
    const next=()=>new Promise((resolve,reject)=>{if(queue.length)return resolve(queue.shift());const timer=setTimeout(()=>reject(new Error('Python response timeout')),180000);timer.unref();waiting.push(v=>{clearTimeout(timer);resolve(v)})})
    const send=data=>{pythonChild.stdin.write(JSON.stringify(data)+'\n');return next()}
    pythonChild=spawn(python,['-B','scripts/stress-client-relays.py',source,String(ports.tcpPort),'1'],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',STRESS_GAME_DELAY_MS:'500',STRESS_PYTHON_PACKAGES:join(tmpdir(),'aion2web-load-python')},stdio:['pipe','pipe','pipe']})
    pythonExit=new Promise(r=>pythonChild.once('exit',r))
    pythonChild.stderr.on('data',b=>errors.push({role:'client',message:b.toString().slice(0,1500)}))
    createInterface({input:pythonChild.stdout}).on('line',line=>{try{const value=JSON.parse(line);waiting.length?waiting.shift()(value):queue.push(value)}catch{}})
    if((await next()).ready!==1)throw new Error('Client failed to connect')
    await Promise.all(pages.map(p=>p.waitForFunction(()=>window.api.agents.some(a=>a.agentId==='load-0'))))
    brokerStats=await rpc(broker,'stats');report.connectionsBeforeTraffic=brokerStats.connected
    if(brokerStats.connected!==total+1)throw new Error('Broker connection count mismatch')
    console.log(JSON.stringify({phase:'ready',consoles:total,brokerConnections:brokerStats.connected}))
    for(let i=0;i<stages.length;i++){
      const [rate,seconds]=stages[i],stage='chat-'+i,expected=rate*seconds,startAt=Date.now()
      await rpc(broker,'stage',{stage});await Promise.all(workers.map(w=>rpc(w.child,'stage',{stage})))
      await Promise.all(pages.map(p=>p.evaluate(stage=>{window.stats={stage,seen:new Set(),latencies:[],longTasks:[]}},stage)))
      console.log(JSON.stringify({phase:'chat',rate,seconds,expectedDeliveries:expected*total}))
      const traffic=await send({action:'traffic',rate,seconds,stage,content:'模拟实时聊天：招募队友，副本进度和装备交流。'.repeat(4)})
      let observed
      const deadline=Date.now()+30000
      do{
        workerStats=await Promise.all(workers.map(w=>rpc(w.child,'stats')))
        observed=await Promise.all(pages.map(p=>p.evaluate(()=>({count:window.stats.seen.size,latencies:window.stats.latencies,longTasks:window.stats.longTasks,heapMB:performance.memory?.usedJSHeapSize/2**20,connected:window.api.connectionState==='connected'}))))
        if(workerStats.every(w=>w.perConsole.every(n=>n===expected))&&observed.every(p=>p.count===expected))break
        await delay(500)
      }while(Date.now()<deadline&&!abortReason)
      const browserLatency=histogram();for(const p of observed)for(const ms of p.latencies)record(browserLatency,ms)
      brokerStats=await rpc(broker,'stats');const clientStats=await send({action:'stats'})
      const received=workerStats.reduce((n,w)=>n+w.received,0)+observed.reduce((n,p)=>n+p.count,0)
      const entry={rate,seconds,startAt,endAt:Date.now(),generated:traffic.traffic,generationMs:traffic.generationMs,expectedDeliveries:expected*total,received,
        minPerConsole:Math.min(...workerStats.flatMap(w=>w.perConsole),...observed.map(p=>p.count)),maxPerConsole:Math.max(...workerStats.flatMap(w=>w.perConsole),...observed.map(p=>p.count)),
        brokerChat:brokerStats.chat,payloadBytes:brokerStats.bytes,brokerPublishEventLatencyMs:summarize(brokerStats.latency),
        protocolLatencyMs:summarize(merge(workerStats.map(w=>w.latency))),browserLatencyMs:summarize(browserLatency),
        browserLongTasks:observed.flatMap(p=>p.longTasks),browserHeapMB:observed.map(p=>Math.round(p.heapMB)),
        duplicates:workerStats.reduce((n,w)=>n+w.duplicates,0),outOfOrder:workerStats.reduce((n,w)=>n+w.outOfOrder,0),
        connectedConsoles:workerStats.reduce((n,w)=>n+w.connected,0)+observed.filter(p=>p.connected).length,brokerConnections:brokerStats.connected,
        reconnects:workerStats.reduce((n,w)=>n+w.reconnects,0),clientStats}
      report.stages.push(entry);save();console.log(JSON.stringify({...entry,clientStats:{...clientStats,resourceSamples:undefined},browserLongTasks:entry.browserLongTasks.length}))
      if(received!==expected*total||entry.connectedConsoles!==total||clientStats.outbox||abortReason)throw new Error(abortReason||'Chat stage did not drain cleanly')
    }
    const before=await send({action:'stats'}),burstStage='burst-chat',burstChatRate=10,burstSeconds=30
    await rpc(broker,'stage',{stage:burstStage});await Promise.all(workers.map(w=>rpc(w.child,'stage',{stage:burstStage})))
    await Promise.all(pages.map(p=>p.evaluate(stage=>{window.stats={stage,seen:new Set(),latencies:[],longTasks:[]}},burstStage)))
    const startAt=Date.now()+3000
    console.log(JSON.stringify({phase:'1000 simultaneous commands with live chat',startAt,commands:total}))
    const burstTraffic=send({action:'traffic',rate:burstChatRate,seconds:burstSeconds,stage:burstStage,content:'并发指令期间持续实时聊天。'.repeat(6)})
    const outcomes=(await Promise.all([
      ...workers.map(w=>rpc(w.child,'burst',{startAt})),
      ...pages.map(p=>p.evaluate(async startAt=>{await new Promise(r=>setTimeout(r,Math.max(0,startAt-Date.now())));const publishedAt=Date.now();const result=await window.api.sendCommandWithReceipt('load-0',{type:'sendWhisper',characterId:'fixture',content:'isolated 1000-console burst'});return [{status:result.status,ms:Date.now()-publishedAt,publishedAt}]},startAt))
    ])).flat()
    const generated=await burstTraffic;await delay(2000)
    const after=await send({action:'stats'});workerStats=await Promise.all(workers.map(w=>rpc(w.child,'stats')));brokerStats=await rpc(broker,'stats')
    const browserResults=await Promise.all(pages.map(p=>p.evaluate(()=>({received:window.stats.seen.size,latencies:window.stats.latencies,longTasks:window.stats.longTasks}))))
    const statuses={},byStatus={}
    for(const r of outcomes){statuses[r.status]=(statuses[r.status]||0)+1;byStatus[r.status]??=histogram();record(byStatus[r.status],r.ms)}
    const browserLatency=histogram();for(const p of browserResults)for(const ms of p.latencies)record(browserLatency,ms)
    report.burst={submitted:outcomes.length,statuses,latencyByStatus:Object.fromEntries(Object.entries(byStatus).map(([k,v])=>[k,summarize(v)])),
      publishSpreadMs:Math.max(...outcomes.map(r=>r.publishedAt))-Math.min(...outcomes.map(r=>r.publishedAt)),executed:after.executed-before.executed,
      clientStats:after,chatGenerated:generated.traffic,chatExpectedDeliveries:generated.traffic*total,chatReceived:workerStats.reduce((n,w)=>n+w.received,0)+browserResults.reduce((n,p)=>n+p.received,0),
      chatProtocolLatencyMs:summarize(merge(workerStats.map(w=>w.latency))),chatBrowserLatencyMs:summarize(browserLatency),browserLongTasks:browserResults.flatMap(p=>p.longTasks),brokerConnections:brokerStats.connected}
    if(outcomes.length!==total||statuses.unknown||statuses.failed||after.executed-before.executed!==(statuses.confirmed||0)||after.active||report.burst.chatReceived!==generated.traffic*total)throw new Error('Burst mismatch, timeouts, or chat loss')
    console.log(JSON.stringify({...report.burst,clientStats:{...after,resourceSamples:undefined},browserLongTasks:report.burst.browserLongTasks.length}))
    report.passed=true
  }catch(error){report.passed=false;report.error=String(error);process.exitCode=1;console.error(String(error))}
  finally{
    clearInterval(guard);clearInterval(sampler)
    report.errors=errors;report.coordinatorResources=resources;report.brokerResources=brokerStats?.resources
    report.subscriberResources=workerStats.map(w=>w.resources);report.freeGiBAtEnd=freemem()/2**30
    if(workerStats.some(w=>w.errors.length)||errors.length){report.passed=false;process.exitCode=1}
    save()
    if(pythonChild?.exitCode===null){pythonChild.stdin.write('{"action":"stop"}\n');await Promise.race([pythonExit,delay(5000)]);if(pythonChild.exitCode===null)pythonChild.kill()}
    if(browser)await browser.close()
    for(const c of children)if(c.exitCode===null)c.kill()
    if(web){web.closeAllConnections();await new Promise(r=>web.close(r))}
    for(const pending of rpcs.values())clearTimeout(pending.timer)
    console.log(JSON.stringify({complete:report.passed,report:reportFile}))
  }
}
