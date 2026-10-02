import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const source = readFileSync(new URL('../src/lib/use-aion-console.ts', import.meta.url), 'utf8')
  .replace("await import('mqtt')", 'await window.loadMqtt()')
const fixture = `
import {createRoot} from 'react-dom/client'
localStorage.setItem('aion2-mqtt-url','wss://fixture.invalid')
localStorage.setItem('aion2-selected-agent-id','40')
window.liveAgents = ['40','A2','A3']
window.loadMqtt = async () => ({connect: () => {
  const handlers = new Map(), topics = new Set()
  const client = {connected:true, topics,
    on:(type,fn)=>handlers.set(type,fn),
    emit:(type,...args)=>handlers.get(type)?.(...args),
    end:()=>{client.connected=false;topics.clear()},
    subscribe:(wanted,options,callback)=>{wanted.forEach(t=>topics.add(t));callback(null,wanted.map(topic=>({topic,qos:1})))},
    unsubscribe:removed=>removed.forEach(t=>topics.delete(t)),
    publish:()=>{},
    receive:(topic,payload)=>{
      const matches = [...topics].some(filter => filter.split('/').every((part,i)=>part==='+'||part===topic.split('/')[i]))
      if(matches) client.emit('message',topic,new TextEncoder().encode(JSON.stringify(payload)),{retain:false})
    }
  }
  window.client=client
  return client
}})
window.beat=()=>window.liveAgents.forEach(agentId=>window.client.receive(
  'aion2-chat-bridge/aion2-local/agents/'+agentId+'/status',
  {type:'agent_status',agentId,host:agentId,status:'online',time:new Date().toISOString(),serverId:'2017'}))
function Fixture(){const api=useAionConsole();useEffect(()=>{window.api=api});return <div>{api.agents.map(a=>a.agentId).join(',')}</div>}
createRoot(document.getElementById('root')).render(<Fixture/>)
`
const bundle = await build({stdin:{contents:source+fixture,resolveDir:root+'src/lib',loader:'tsx'},bundle:true,write:false,
  format:'iife',platform:'browser',jsx:'automatic',alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const server = createServer((request,response)=>{
  response.setHeader('Content-Type',request.url==='/bundle.js'?'application/javascript':'text/html')
  response.end(request.url==='/bundle.js'?bundle.outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
let browser
try {
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'})
  const page=await browser.newPage(), errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.clock.install()
  await page.goto('http://127.0.0.1:'+server.address().port)
  await page.waitForFunction(()=>window.api&&window.client)
  await page.evaluate(()=>{window.client.emit('connect');window.beat();window.heartbeat=setInterval(window.beat,15000)})
  const ids=()=>page.evaluate(()=>window.api.agents.map(a=>a.agentId).sort())
  assert.deepEqual(await ids(),['40','A2','A3'])
  for(const selected of ['40','A3','']) {
    await page.evaluate(id=>window.api.setSelectedAgentId(id),selected)
    await page.clock.runFor(120000)
    assert.deepEqual(await ids(),['40','A2','A3'],'All live clients survive beyond 5-second discovery and 45-second TTL, selection='+selected)
    const topics=await page.evaluate(()=>[...window.client.topics].sort())
    assert.deepEqual(topics,[
      'aion2-chat-bridge/aion2-local/agents/+/status',
      ...(selected?['chat','receipts'].map(kind=>'aion2-chat-bridge/aion2-local/events/'+selected+'/'+kind):[]),
    ].sort(),'Only status is shared across clients; chat and receipts stay scoped')
  }
  await page.evaluate(()=>{window.liveAgents=['40','A3']})
  await page.clock.runFor(51000)
  assert.deepEqual(await ids(),['40','A3'],'A genuinely missing heartbeat still expires')
  await page.evaluate(()=>{window.liveAgents.push('A2');window.beat()})
  assert.deepEqual(await ids(),['40','A2','A3'],'Returning client appears without refreshing')
  await page.evaluate(()=>{
    window.client.connected=false;window.client.emit('close');window.client.topics.clear()
    window.client.connected=true;window.client.emit('connect');window.beat()
  })
  await page.clock.runFor(60000)
  assert.deepEqual(await ids(),['40','A2','A3'],'Reconnect restores continuous presence subscription')
  assert.deepEqual(errors,[])
  console.log('PASS: real React hook with MQTT subscription filtering; three clients stay online for six simulated minutes across selection/deselection; true expiry, return without refresh, reconnect, and scoped chat/receipts')
} finally {
  await browser?.close()
  await new Promise(resolve=>server.close(resolve))
}
