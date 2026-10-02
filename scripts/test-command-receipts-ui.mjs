import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const fixture = `import {createRoot} from 'react-dom/client';import {useAionConsole} from './src/lib/use-aion-console';
function Fixture(){window.api=useAionConsole();return null}window.root=createRoot(document.getElementById('root'));window.root.render(<Fixture/>);`
const bundle = await build({ stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'mqtt-fixture',setup(b){
    b.onResolve({filter:/^mqtt$/},()=>({path:'mqtt',namespace:'fixture'}))
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export function connect(){
      const handlers=new Map();window.mqttHandlers=handlers;window.commands=[];window.topics=new Set();window.subscriptions=[];
      const client={connected:true,on(type,fn){handlers.set(type,fn);if(type==='connect')setTimeout(fn,0);return client},subscribe(topics,options,cb){window.subscriptions.push(topics);topics.forEach(t=>window.topics.add(t));cb(null,topics.map(topic=>({topic,qos:1})))},unsubscribe(topics){topics.forEach(t=>window.topics.delete(t))},end(){client.connected=false},publish(topic,json){window.commands.push(JSON.parse(json))}};
      window.emitReceipt=(agent,receipt,retain=false,channel='receipts')=>handlers.get('message')('aion2-chat-bridge/aion2-local/events/'+agent+'/'+channel,new TextEncoder().encode(JSON.stringify(receipt)),{retain});return client;
    }`}))
  }}] })
const server = createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}
  res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script>localStorage.setItem("aion2-mqtt-url","ws://fixture");</script><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'})
try {
  const page=await browser.newPage(), errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(()=>window.api?.connectionState==='connected')
  await page.evaluate(()=>window.api.setSelectedAgentId('A1'))
  assert.deepEqual(await page.evaluate(()=>[...window.topics].sort()),[
    'aion2-chat-bridge/aion2-local/agents/+/status',
    'aion2-chat-bridge/aion2-local/events/A1/chat',
    'aion2-chat-bridge/aion2-local/events/A1/receipts',
  ])
  await page.evaluate(()=>{
    window.pending=window.api.sendCommandWithReceipt('A1',{type:'sendWhisper',content:'offline fixture'})
    window.pending.then(result=>window.outcome=result)
    window.command=window.commands.at(-1)
    window.emitReceipt('A2',{type:'control_result',requestId:window.command.requestId,ok:true})
    window.emitReceipt('A1',{type:'control_result',requestId:window.command.requestId,ok:true},true)
  })
  assert.equal(await page.evaluate(()=>window.outcome), undefined)
  const confirmed=await page.evaluate(async()=>{
    window.emitReceipt('A1',{type:'control_result',requestId:window.command.requestId,ok:true},false,'chat')
    return await window.pending
  })
  assert.equal(confirmed.status,'confirmed')
  assert.equal(confirmed.requestId,await page.evaluate(()=>window.command.requestId))
  assert.ok(await page.evaluate(()=>window.command.expiresAt > Date.now() && window.command.expiresAt <= Date.now()+30_000))
  assert.ok(await page.evaluate(()=>{
    window.api.sendCommand('A1',{type:'sendWhisper',content:'manual fixture'})
    const command=window.commands.at(-1)
    return command.expiresAt > Date.now() && command.expiresAt <= Date.now()+30_000
  }))
  for (const status of ['unknown','not_sent']) {
    const outcome=await page.evaluate(async status=>{
      const pending=window.api.sendCommandWithReceipt('A1',{type:'sendWhisper',content:'receipt fixture'})
      const requestId=window.commands.at(-1).requestId
      window.emitReceipt('A1',{type:'control_result',requestId,ok:false,status,error:'fixture '+status})
      return await pending
    },status)
    assert.equal(outcome.status,status)
    assert.equal(outcome.sent,false)
    assert.equal(outcome.message,'fixture '+status)
    await page.waitForFunction(status=>window.api.messages.some(message=>
      message.type==='control_result' && message.title === '控制命令 · '+
        (status==='unknown'?'执行结果未确认':'未执行')),status)
  }
  const switched=await page.evaluate(async()=>{
    const pending=window.api.sendCommandWithReceipt('A1',{type:'sendWhisper',content:'switch fixture'})
    window.api.setSelectedAgentId('A2')
    window.emitReceipt('A1',{type:'chat_message',content:'old-client-packet'},false,'chat')
    return await pending
  })
  assert.equal(switched.status,'unknown')
  assert.ok((await page.evaluate(()=>[...window.topics])).every(topic=>topic.includes('/A2/')||topic.endsWith('/agents/+/status')))
  assert.equal(await page.evaluate(()=>window.api.sendCommand('A1',{type:'sendWhisper',content:'wrong client'})),false)
  assert.equal(await page.evaluate(()=>window.api.messages.some(message=>message.content==='old-client-packet')),false)
  await page.evaluate(()=>window.api.setSelectedAgentId('A1'))
  await page.evaluate(()=>window.api.publishDiscover())
  assert.ok(await page.evaluate(()=>window.topics.has('aion2-chat-bridge/aion2-local/agents/+/status')))
  assert.equal(await page.evaluate(()=>window.subscriptions.some(topics=>topics.some(topic=>topic.includes('/events/+/')))),false)
  const disconnected=await page.evaluate(async()=>{
    const pending=window.api.sendCommandWithReceipt('A1',{type:'sendWhisper',content:'offline fixture'})
    window.mqttHandlers.get('close')()
    return await pending
  })
  assert.equal(disconnected.status,'unknown')
  await page.evaluate(()=>window.mqttHandlers.get('connect')())
  const unmounted=await page.evaluate(async()=>{
    const pending=window.api.sendCommandWithReceipt('A1',{type:'sendWhisper',content:'offline fixture'})
    window.root.unmount()
    return await pending
  })
  assert.equal(unmounted.status,'unknown')
  assert.deepEqual(errors,[])
  console.log('PASS: actual React MQTT hook correlates published request IDs, ignores retained/wrong-client receipts and settles pending execution on close/unmount')
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
