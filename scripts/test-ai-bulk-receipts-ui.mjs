import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const source = readFileSync(root+'src/routes/index.tsx','utf8').replace('  function sendJsonCommand()',
  '  window.startBulk=sendWhisperToAll; window.resumeBulk=resumeBulkSend; window.stopBulk=stopBulkSend;\n  function sendJsonCommand()')
const fixture=`import {createRoot} from 'react-dom/client';createRoot(document.getElementById('root')).render(<AuthenticatedHome section="messages" user={{userKey:'a',username:'Alice',role:'agent'}} onLogout={()=>{}}/>);`
const bundle=await build({stdin:{contents:source+fixture,resolveDir:root+'src/routes',loader:'tsx'},bundle:true,write:false,outdir:'fixture',platform:'browser',format:'iife',jsx:'automatic',alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'},logLevel:'silent',plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/^(@tanstack\/react-router|mqtt)$/},args=>({path:args.path,namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({resolveDir:root,loader:'tsx',contents:args.path==='mqtt'?`
    export function connect(){const handlers=new Map();window.commands=[];
      const client={connected:true,on(type,fn){handlers.set(type,fn);if(type==='connect')setTimeout(fn,0);return client},subscribe(topics,options,callback){if(typeof options==='function')options();else callback?.(null,[{topic:topics,qos:1}])},unsubscribe(){},end(){client.connected=false},publish(topic,json,options,callback){callback?.();const value=JSON.parse(json);if(value.type==='discover')window.heartbeat();if(value.type==='sendWhisper'){window.commands.push(value);if(window.autoReceipt)queueMicrotask(()=>window.receipt(value.characterId!=='2'||window.allSuccess===true))}}};
      window.receipt=ok=>handlers.get('message')('aion2-chat-bridge/aion2-local/events/A1/chat',new TextEncoder().encode(JSON.stringify({type:'control_result',agentId:'A1',requestId:window.commands.at(-1).requestId,ok,time:new Date().toISOString()})));
      window.heartbeat=()=>handlers.get('message')('aion2-chat-bridge/aion2-local/agents/A1/status',new TextEncoder().encode(JSON.stringify({type:'agent_status',agentId:'A1',host:'A1',room:'aion2-local',serverId:'1001',status:'online',time:new Date().toISOString()})));return client;
    }`:`import React from 'react';export const createFileRoute=()=>v=>v;export const useNavigate=()=>()=>{};export const Link=({children,to,...props})=><a href={to} {...props}>{children}</a>;`}))
}}]})
const characters=[1,2,3].map(id=>({id,characterId:String(id),characterName:'Role '+id,serverId:'1001',level:1}))
const server=createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(x=>x.path.endsWith('.js')).text);return}
  if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,characters,entries:[],servers:[{serverId:'1001',serverName:'Test',legions:[],characterCount:3}],messages:[],nextCursor:null,totalCount:3}));return}
  res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'})
try {
  const context=await browser.newContext();await context.addInitScript(()=>{localStorage.setItem('aion2-selected-agent-id','A1');localStorage.setItem('aion2-mqtt-url','ws://fixture')})
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)})
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByPlaceholder('发送消息给 Role 1').waitFor()
  await page.locator('.broadcast-character').click()
  await page.getByLabel('群发间隔最小毫秒').fill('1000');await page.getByLabel('群发间隔最大毫秒').fill('1000')
  await page.evaluate(()=>{
    window.autoReceipt=true
    window.recipients=[1,2,3].map(id=>({characterId:String(id),name:'Role '+id,serverKey:'1001'}))
    window.pending=window.startBulk(async()=>window.recipients,{content:'local fixture',requireReceipts:true})
  })
  const partial=await page.evaluate(()=>window.pending)
  assert.equal(partial.sent,false)
  assert.equal(partial.status,'partial')
  assert.equal(partial.confirmedCount,1)
  assert.equal(partial.failedCount,1)
  assert.equal(partial.sentCount,2)
  assert.deepEqual(await page.evaluate(()=>window.commands.map(c=>c.characterId)),['1','2'])
  await page.evaluate(()=>window.resumeBulk())
  await page.waitForFunction(()=>window.commands.length===3)
  await page.getByText(/确认成功 2，失败 1/).first().waitFor()
  assert.deepEqual(await page.evaluate(()=>window.commands.map(c=>c.characterId)),['1','2','3'],'Resume must not replay the failed attempted recipient')
  await page.evaluate(()=>{
    window.autoReceipt=false
    window.controller=new AbortController()
    window.pending=window.startBulk(async()=>window.recipients,{content:'cancel fixture',requireReceipts:true,signal:window.controller.signal})
  })
  await page.waitForFunction(()=>window.commands.length===4)
  const stopped=await page.evaluate(async()=>{window.controller.abort();return await window.pending})
  assert.equal(stopped.status,'unknown')
  assert.equal(stopped.unknownCount,1)
  assert.equal(stopped.sentCount,1)
  await page.evaluate(()=>{window.autoReceipt=true;window.allSuccess=true;window.resumeBulk()})
  await page.waitForFunction(()=>window.commands.length===6)
  await page.getByText(/确认成功 2，失败 0，结果未确认 1/).first().waitFor()
  assert.deepEqual(await page.evaluate(()=>window.commands.slice(3).map(c=>c.characterId)),['1','2','3'],'Cancelled uncertain attempt must not be repeated')
  const success=await page.evaluate(()=>window.startBulk(async()=>window.recipients,{content:'success fixture',requireReceipts:true}))
  assert.equal(success.status,'confirmed')
  assert.equal(success.sent,true)
  assert.equal(success.confirmedCount,3)
  assert.deepEqual(errors,[])
  console.log('PASS: real portal + MQTT hook: mixed batch receipts, stop with unknown outcome, exact remaining-recipient resume and fully confirmed success')
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
