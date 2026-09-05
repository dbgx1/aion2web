import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
// Gate only the dynamic module import to reproduce a slow initial download.
const source = readFileSync(new URL('../src/lib/use-aion-console.ts', import.meta.url), 'utf8').replace("await import('mqtt')", 'await window.loadMqtt()')
const fixture = `
import {createRoot} from 'react-dom/client'
import {useChatHistory} from '#/lib/use-chat-history'
window.clients=[];window.imports=[]
window.loadMqtt=()=>new Promise(resolve=>window.imports.push(()=>resolve({connect:(url,options)=>{
  const handlers=new Map()
  const client={connected:true,url,options,ended:false,
    on:(type,fn)=>{handlers.set(type,fn)},emit:(type,...args)=>handlers.get(type)?.(...args),
    end:()=>{client.ended=true;client.connected=false},publish:()=>{},subscribe:(topics,callback)=>{callback?.()}}
  window.clients.push(client);return client
}})))
function MqttFixture(){const api=useAionConsole();useEffect(()=>{window.api=api});return <div>{api.connectionState}</div>}
function HistoryFixture(){const [role,setRole]=useState('a');const history=useChatHistory('1001',role)
  useEffect(()=>{window.historyApi={...history,setRole}})
  return <div>{history.messages.map(message=><p key={message.id}>{message.content}</p>)}<span>{history.loading?'loading':'ready'}</span></div>}
const root=createRoot(document.getElementById('root'))
window.unmount=()=>root.unmount()
root.render(location.pathname==='/history'?<HistoryFixture/>:<MqttFixture/>)
`
const bundle = await build({ stdin: {contents:source+fixture,resolveDir:root+'src/lib',loader:'tsx'},bundle:true,write:false,
  format:'iife',platform:'browser',jsx:'automatic',alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent' })
const server=createServer((request,response)=>{
  if(request.url==='/bundle.js'){response.setHeader('Content-Type','application/javascript');response.end(bundle.outputFiles[0].text);return}
  if(request.url.startsWith('/api/')){response.setHeader('Content-Type','application/json');response.end('{"ok":true}');return}
  response.setHeader('Content-Type','text/html');response.end('<div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'})
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message))
  const base=`http://127.0.0.1:${server.address().port}`
  await page.clock.install()
  await page.goto(base)
  await page.waitForFunction(()=>window.api&&window.imports.length===1)
  await page.evaluate(()=>{window.api.connect();window.api.connect()})
  assert.equal(await page.evaluate(()=>window.imports.length),1,'One pending MQTT import, even before a client exists')
  await page.evaluate(()=>{window.api.disconnect();window.api.connect();window.imports[0]()})
  assert.equal(await page.evaluate(()=>window.clients.length),0,'Cancelled import cannot create a zombie connection')
  await page.evaluate(()=>window.imports[1]())
  await page.waitForFunction(()=>window.clients.length===1)
  await page.evaluate(()=>{window.clients[0].emit('connect');window.api.setSelectedAgentId('A1')})
  const status=(agentId)=>({type:'agent_status',agentId,status:'online',time:new Date().toISOString(),host:agentId})
  await page.evaluate(payload=>window.clients[0].emit('message','aion2-chat-bridge/aion2-local/agents/'+payload.agentId+'/status',new TextEncoder().encode(JSON.stringify(payload))),status('A2'))
  assert.equal(await page.evaluate(()=>window.api.selectedAgentId),'A1','First discovery reply must not clear remembered A1')
  await page.evaluate(payload=>window.clients[0].emit('message','aion2-chat-bridge/aion2-local/agents/'+payload.agentId+'/status',new TextEncoder().encode(JSON.stringify(payload))),status('A1'))
  assert.equal(await page.evaluate(()=>window.api.selectedAgentId),'A1')
  await page.clock.runFor(18_000)
  assert.equal(await page.evaluate(()=>window.api.agents.some(agent=>agent.agentId==='A1')),true,'A brief heartbeat gap must not drop the client')
  await page.clock.runFor(30_000)
  await page.evaluate(()=>window.clients[0].emit('message','aion2-chat-bridge/aion2-local/agents/A2/status',new TextEncoder().encode(JSON.stringify({type:'agent_status',agentId:'A2',status:'online',time:new Date().toISOString()}))))
  assert.equal(await page.evaluate(()=>window.api.agents.some(agent=>agent.agentId==='A1')),false,'Expired heartbeat removes presence')
  assert.equal(await page.evaluate(()=>window.api.selectedAgentId),'A1','Expired heartbeat must preserve selection')
  assert.equal(await page.evaluate(()=>localStorage.getItem('aion2-selected-agent-id')),'A1')
  await page.evaluate(()=>window.clients[0].emit('message','aion2-chat-bridge/aion2-local/agents/A1/status',new TextEncoder().encode(JSON.stringify({type:'agent_status',agentId:'A1',status:'online',time:new Date().toISOString()}))))
  assert.equal(await page.evaluate(()=>window.api.agents.some(agent=>agent.agentId==='A1')),true,'Heartbeat restores presence without reselecting')
  await page.evaluate(()=>{
    const emit=(agentId,time,retain=false,extra={})=>window.clients[0].emit('message','aion2-chat-bridge/aion2-local/agents/'+agentId+'/status',new TextEncoder().encode(JSON.stringify({type:'agent_status',agentId,status:'online',time,...extra})),{retain})
    emit('skewed',new Date(Date.now()-3600000).toISOString())
    emit('stale-retained',new Date(Date.now()-3600000).toISOString(),true)
    emit('A1',new Date(Date.now()-3600000).toISOString(),true,{status:'offline',will:true})
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.testVisibility||'visible'})
    window.testVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'))
  })
  assert.equal(await page.evaluate(()=>window.api.agents.some(agent=>agent.agentId==='skewed')),true,'Live heartbeat uses reception time even if client clock is slow')
  assert.equal(await page.evaluate(()=>window.api.agents.some(agent=>agent.agentId==='stale-retained')),false,'Old retained online status cannot resurrect a client')
  assert.equal(await page.evaluate(()=>window.api.agents.some(agent=>agent.agentId==='A1')),true,'Old retained will cannot erase a fresh heartbeat')
  await page.clock.runFor(120000)
  assert.equal(await page.evaluate(()=>window.api.agents.some(agent=>agent.agentId==='A1')),true,'Hidden browser must not declare clients offline')
  await page.evaluate(()=>{window.testVisibility='visible';document.dispatchEvent(new Event('visibilitychange'))})
  await page.clock.runFor(18000)
  assert.equal(await page.evaluate(()=>window.api.agents.some(agent=>agent.agentId==='A1')),true,'Returning browser grants a full observation window')
  await page.clock.runFor(30000)
  assert.equal(await page.evaluate(()=>window.api.agents.some(agent=>agent.agentId==='A1')),false,'Visible connected browser eventually detects real missing heartbeats')
  await page.clock.resume()
  assert.equal(await page.evaluate(()=>window.clients[0].options.queueQoSZero),false)
  let offlineReports=0
  await page.route('**/api/client-locks',route=>{offlineReports++;return route.fulfill({status:503,json:{error:'unavailable'}})})
  const failedReport=page.waitForResponse(response=>response.url().endsWith('/api/client-locks'))
  await page.evaluate(()=>window.clients[0].emit('message','aion2-chat-bridge/aion2-local/agents/offline-test/status',new TextEncoder().encode(JSON.stringify({type:'agent_status',agentId:'offline-test',status:'offline',time:new Date().toISOString()}))))
  await failedReport
  for(let i=0;i<10;i++) await page.evaluate(payload=>window.clients[0].emit('message','aion2-chat-bridge/aion2-local/agents/'+payload.agentId+'/status',new TextEncoder().encode(JSON.stringify(payload))),status('A2'))
  assert.equal(offlineReports,1,'Other agents\' heartbeats must not immediately retry a failed offline report')
  await page.unroute('**/api/client-locks')
  await page.evaluate(()=>{window.api.reconnect({room:'new',mqttUrl:'wss://example.test',prefix:'new'});window.imports[2]()})
  await page.waitForFunction(()=>window.clients.length===2)
  await page.evaluate(()=>{window.clients[0].emit('connect');window.clients[0].emit('error',new Error('obsolete error'))})
  assert.notEqual(await page.evaluate(()=>window.api.connectionState),'error','Old client callbacks cannot overwrite new state')
  assert.equal(await page.evaluate(()=>window.clients[0].ended),true)
  await page.evaluate(()=>{window.api.reconnect({room:'third',mqttUrl:'wss://example.test',prefix:'third'});window.unmount();window.imports[3]()})
  assert.equal(await page.evaluate(()=>window.clients.length),2,'Unmount invalidates unresolved import')

  let olderRequests=0,olderRoute
  let resolveOlder
  const olderReceived=new Promise(resolve=>resolveOlder=resolve)
  await page.route('**/api/messages?**',async route=>{
    const url=new URL(route.request().url())
    if(url.searchParams.has('before')){olderRequests++;olderRoute=route;resolveOlder();return}
    const role=url.searchParams.get('characterId')
    await route.fulfill({json:{ok:true,messages:[{id:5,content:role+' latest'}],nextCursor:4}})
  })
  await page.goto(base+'/history')
  await page.getByText('a latest',{exact:true}).waitFor()
  const cancelled=page.waitForEvent('requestfailed',request=>request.url().includes('before='))
  await page.evaluate(()=>{window.historyApi.loadOlder();window.historyApi.loadOlder()})
  await olderReceived
  assert.equal(olderRequests,1,'Double click cannot start concurrent history pages')
  await page.evaluate(()=>window.historyApi.setRole('b'))
  await cancelled
  await olderRoute.fulfill({json:{ok:true,messages:[{id:3,content:'a older'}],nextCursor:null}}).catch(()=>{})
  await page.getByText('b latest',{exact:true}).waitFor()
  assert.equal(await page.getByText('a older',{exact:true}).count(),0,'Late older history cannot enter another conversation')
  assert.equal(await page.getByText('a latest',{exact:true}).count(),0)
  await page.unroute('**/api/messages?**')
  let pageFailure='http'
  const requestedCursors=[]
  await page.route('**/api/messages?**',route=>{
    const url=new URL(route.request().url()),before=Number(url.searchParams.get('before')||0)
    requestedCursors.push(before)
    if(before===2&&pageFailure==='http')return route.fulfill({status:503,json:{error:'retry older page'}})
    if(before===2&&pageFailure==='cursor')return route.fulfill({json:{ok:true,messages:[],nextCursor:2}})
    return route.fulfill({json:{ok:true,messages:[{id:before?before-1:5,content:before?'older-'+before:'c latest'}],nextCursor:before===2?null:before?2:4}})
  })
  await page.evaluate(()=>window.historyApi.setRole('c'))
  await page.getByText('c latest',{exact:true}).waitFor()
  await page.evaluate(()=>window.historyApi.loadOlder())
  await page.getByText('older-4',{exact:true}).waitFor()
  await page.evaluate(()=>window.historyApi.loadOlder())
  await page.waitForFunction(()=>window.historyApi.error==='retry older page')
  pageFailure='cursor'
  await page.evaluate(()=>window.historyApi.retry())
  await page.waitForFunction(()=>window.historyApi.error.includes('响应无效'))
  assert.equal(requestedCursors.at(-1),2,'Retry must retain the failed older cursor instead of replacing history with page one')
  assert.equal(await page.getByText('older-4',{exact:true}).count(),1)
  pageFailure=''
  await page.evaluate(()=>window.historyApi.retry())
  await page.getByText('older-2',{exact:true}).waitFor()
  assert.equal(await page.getByText('c latest',{exact:true}).count(),1)
  assert.equal(await page.getByText('older-4',{exact:true}).count(),1)
  assert.equal(await page.evaluate(()=>window.historyApi.cursor),null)
  assert.deepEqual(errors,[])
  console.log('PASS: MQTT import/reconnect/unmount races, out-of-order discovery, obsolete callbacks; history double-click and cancellation on recipient change')
  console.log('PASS: failed older-page retry retains loaded history; repeating cursor is rejected and remains retryable')
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
