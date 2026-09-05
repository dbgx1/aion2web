import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
const { chromium }=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const root=fileURLToPath(new URL('../',import.meta.url))
const source=readFileSync(root+'src/routes/index.tsx','utf8')
const fixture=`import {createRoot} from 'react-dom/client';function Fixture(){const [section,setSection]=useState('messages');window.section=setSection;return <AuthenticatedHome section={section} user={{userKey:'a',username:'Alice',role:'agent'}} onLogout={()=>{}}/>}createRoot(document.getElementById('root')).render(<Fixture/>);`
const bundle=await build({stdin:{contents:source+fixture,resolveDir:root+'src/routes',loader:'tsx'},bundle:true,write:false,outdir:'fixture',platform:'browser',format:'iife',jsx:'automatic',alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'},logLevel:'silent',plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/^(@tanstack\/react-router|mqtt)$/},args=>({path:args.path,namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({resolveDir:root,loader:'tsx',contents:args.path==='mqtt'?`
 export function connect(){const handlers=new Map();const emit=(type,...args)=>{for(const fn of handlers.get(type)||[])fn(...args)};const client={connected:true,on(type,fn){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);if(type==='connect')setTimeout(fn,0);return client},removeListener(type,fn){handlers.get(type)?.delete(fn)},subscribe(topics,options,callback){if(typeof options==='function')options();else callback?.(null,[{topic:topics,qos:1}])},unsubscribe(){},end(){client.connected=false},publish(topic,json,options,callback){const value=JSON.parse(json);callback?.();if(value.type==='discover')window.heartbeat();else if(value.type==='presence_query'){(window.presenceQueries||=[]).push(value);const report=results=>emit('message',value.replyTopic,new TextEncoder().encode(JSON.stringify({type:'presence_result',requestId:value.requestId,results})));window.finishPresenceQuery=()=>report(value.characters.filter(c=>!window.streamPresence||c.characterId!=='3').map(c=>({...c,status:c.characterId==='1'?'online':'offline',checkedAt:Date.now()})));queueMicrotask(()=>window.streamPresence?report(value.characters.filter(c=>c.characterId==='3').map(c=>({...c,status:'online',checkedAt:Date.now()}))):window.finishPresenceQuery())}else if(topic.includes('/control/')){(window.commands||=[]).push(value);queueMicrotask(()=>window.receive({type:'control_result',ok:true,requestId:value.requestId,agentId:'A1',time:new Date().toISOString()}))}}};
 window.receive=value=>emit('message','aion2-chat-bridge/aion2-local/events/A1/chat',new TextEncoder().encode(JSON.stringify(value)));
 window.reply=(role,id)=>window.receive({type:'MESSAGE',method:'GAME',message_id:id,agentId:'A1',time:new Date().toISOString(),payload:{jsonData:{playNcCharId:String(role),serverId:'1001',userName:'Role '+role,isFromGame:false,content:id,gameRoomKeyInfo:{type:'ONE_ON_ONE'}}}});
 window.heartbeat=()=>emit('message','aion2-chat-bridge/aion2-local/agents/A1/status',new TextEncoder().encode(JSON.stringify({type:'agent_status',agentId:'A1',host:'A1',serverId:'1001',room:'aion2-local',status:'online',time:new Date().toISOString()})));
 return client }
 `:`import React from 'react';export const createFileRoute=()=>v=>v;export const useNavigate=()=>()=>{};export const Link=({children,to,...props})=><a href={to} {...props} onClick={event=>{event.preventDefault();window.section(to.slice(1))}}>{children}</a>;`}))
}}]})
const characters=[1,2,3].map(id=>({id,characterId:String(id),characterName:'Role '+id,serverId:'1001',serverName:'Test',legionName:'',className:'',level:1,faction:'',avatarUrl:'',lastSeenAt:0}))
const calls=[], requestTurns=new Map();let fail=false
const historyLookups=[]
let lockAcquiredAt=100, lockOwner='a'
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(x=>x.path.endsWith('.js')).text);return}
 if(req.url==='/styles.css'){res.setHeader('Content-Type','text/css');res.end(readFileSync(root+'src/styles.css'));return}
 if(req.url==='/api/ai/chat'){
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);calls.push(body)
  const {threadId,runId}=body, n=requestTurns.get(threadId)||0;requestTurns.set(threadId,n+1)
  const events=fail?[{type:'RUN_ERROR',message:'429 rate limited'}]:n===0?[
   {type:'RUN_STARTED',threadId,runId},
   {type:'TOOL_CALL_START',toolCallId:'send-'+threadId,toolCallName:'send_private_chat'},
   {type:'TOOL_CALL_ARGS',toolCallId:'send-'+threadId,delta:JSON.stringify({content:'AI reply for '+body.forwardedProps?.selectedCharacter?.characterId})},
   {type:'TOOL_CALL_END',toolCallId:'send-'+threadId},
   {type:'RUN_FINISHED',threadId,runId,outcome:{type:'interrupt',interrupts:[{id:'client_tool_send-'+threadId,reason:'tanstack:client_tool_execution',toolCallId:'send-'+threadId,responseSchema:{},metadata:{kind:'client_tool',toolName:'send_private_chat',input:{content:'AI reply for '+body.forwardedProps?.selectedCharacter?.characterId}}}]}},
  ]:[{type:'RUN_STARTED',threadId,runId},{type:'TEXT_MESSAGE_START',messageId:'done',role:'assistant'},{type:'TEXT_MESSAGE_CONTENT',messageId:'done',delta:'done'},{type:'TEXT_MESSAGE_END',messageId:'done'},{type:'RUN_FINISHED',threadId,runId}]
  res.setHeader('Content-Type','text/event-stream');res.end(events.map(e=>'data: '+JSON.stringify({...e,timestamp:Date.now()})+'\n\n').join(''));return
 }
 if(req.url.startsWith('/api/')){
  if(req.method==='GET'&&req.url.startsWith('/api/messages?'))historyLookups.push(new URL(req.url,'http://localhost').searchParams.get('characterId'))
  let body={ok:true,characters,servers:[],messages:[],nextCursor:null,totalCount:3,locks:[{agentId:'A1',userKey:lockOwner,username:lockOwner==='a'?'Alice':'Bob',acquiredAt:lockAcquiredAt,expiresAt:0}]}
  if(req.url.startsWith('/api/characters?')&&!new URL(req.url,'http://localhost').searchParams.has('bulk'))body={...body,characters:characters.slice(0,2),nextCursor:2}
  if(req.url==='/api/presence/status')body.statuses=characters.map((c,i)=>({serverId:'1001',characterId:c.characterId,name:c.characterName,online:i<2,status:i===0?'online':i===1?'stale':'offline',checkedAt:Date.now()-(i===1?600000:0),updatedAt:Date.now(),sourceId:'test'}))
  if(req.url==='/api/presence/requests'&&req.method==='POST'){let raw='';for await(const part of req)raw+=part;const requestId=crypto.randomUUID();body={query:{type:'presence_query',requestId,serviceId:'test',requestTopic:'aion2/presence/test/requests',replyTopic:'aion2/presence/test/results/'+requestId,expiresAt:Date.now()+180000,characters:JSON.parse(raw).characters}}}
  if(req.url==='/api/messages'&&req.method==='POST'){let raw='';for await(const part of req)raw+=part;body={ok:true,conversations:JSON.parse(raw).conversations.map(c=>({ok:true,serverId:c.serverId,characterId:c.characterId,received:c.messages.length}))}}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return
 }
 res.setHeader('Content-Type','text/html');res.end('<link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:'msedge'})
try{
 const context=await browser.newContext({viewport:{width:1500,height:1000}});await context.addInitScript(()=>localStorage.setItem('aion2-selected-agent-id','A1'))
 const page=await context.newPage(), errors=[];page.on('pageerror',error=>errors.push(error.message))
 const url=`http://127.0.0.1:${server.address().port}`
 await page.goto(url);await page.getByPlaceholder('发送消息给 Role 1').waitFor()
 await page.clock.install()
 const advance=async ms=>{await page.evaluate(()=>window.heartbeat());await page.clock.runFor(ms)}
 const openSetup=async()=>{if(await page.locator('.managed-chat-setup').getAttribute('open')===null)await page.locator('.managed-chat-setup summary').click()}
 await openSetup();await page.getByLabel('托管发送间隔秒').fill('-1')
 assert.equal(await page.getByRole('button',{name:'开启持续托管'}).isDisabled(),true)
 await page.getByRole('alert').getByText('全局发送间隔请输入有效的非负数字。').waitFor()
 for(const value of ['0','0.5','99999']){
  await page.getByLabel('托管发送间隔秒').fill(value)
  await page.getByLabel('托管主动聊天间隔分钟').fill(value)
  assert.equal(await page.getByRole('button',{name:'开启持续托管'}).isEnabled(),true,'Both intervals accept zero, decimals and values above former maxima')
 }
 await page.getByLabel('托管主动聊天间隔分钟').fill('')
 assert.equal(await page.getByRole('button',{name:'开启持续托管'}).isDisabled(),true,'Empty input is not silently treated as zero')
 await page.getByLabel('托管主动聊天间隔分钟').fill('-1')
 assert.equal(await page.getByRole('button',{name:'开启持续托管'}).isDisabled(),true)
 await page.getByLabel('托管主动聊天间隔分钟').fill('10')
 await page.getByLabel('托管发送间隔秒').fill('3')
 assert.equal(await page.getByRole('button',{name:'开启持续托管'}).isEnabled(),true)
 await page.getByRole('button',{name:'开启持续托管'}).click();await page.getByRole('region',{name:'持续托管任务'}).waitFor()
 await page.getByText(/1 个角色 · 已确认发送 0 条/).waitFor()
 await advance(6000);await page.waitForFunction(()=>window.commands?.length===1).catch(async error=>{console.log('DEBUG',calls.map(c=>({forwardedProps:c.forwardedProps,tools:c.tools?.map(t=>t.name)})),await page.locator('.managed-chat-status').innerText(),errors);throw error})
 await page.getByText(/已确认发送 1 条/).waitFor()
 assert.equal(calls[0].forwardedProps.surface,'managed','Vanilla ChatClient body must arrive as forwardedProps')
 assert.equal(calls[0].forwardedProps.task.intervalMs,3000,'Three-second interval reaches the running task')
 assert.equal(calls[0].tools.length,7,'Single conversation omits online query tool')
 assert.equal(calls[0].tools.some(tool=>tool.name==='query_managed_online'),false)
 const historyReadsBeforeReply=historyLookups.filter(id=>id==='1').length
 await page.locator('.character-select-button strong').getByText('Role 2',{exact:true}).click()
 await page.evaluate(()=>window.reply('1','first incoming'))
 await advance(16000);await page.waitForFunction(()=>window.commands.length===2)
 assert.deepEqual(await page.evaluate(()=>window.commands.map(c=>c.characterId)),['1','1'],'Changing selected recipient does not redirect managed sends')
 assert.equal(historyLookups.filter(id=>id==='1').length,historyReadsBeforeReply,'Single-role live reply does not fetch history again')
 await page.evaluate(()=>window.section('clients'));await page.getByRole('heading',{name:'在线客户端',exact:true}).waitFor()
 await page.evaluate(()=>window.reply('1','reply on another page'));await advance(16000)
 await page.waitForFunction(()=>window.commands.length===3)
 await page.getByRole('button',{name:'暂停托管'}).click();await advance(30000)
 assert.equal(await page.evaluate(()=>window.commands.length),3)
 await page.getByRole('button',{name:'停止托管'}).click()
 await page.evaluate(()=>window.section('messages'));await page.getByPlaceholder('发送消息给 Role 2').waitFor()
 await advance(1000)
 await page.evaluate(()=>{window.streamPresence=true})
 await openSetup();await page.getByLabel('托管范围').selectOption('online');await page.getByLabel('托管发送间隔秒').fill('15')
 await page.getByRole('button',{name:'开启持续托管'}).click();await page.getByText(/3 个角色 · 已确认发送 0 条/).waitFor()
 await advance(6000);await page.waitForFunction(()=>window.presenceQueries?.length===1)
 await page.getByRole('button',{name:/^在线 · .*Role 3/}).waitFor()
 assert.equal(await page.locator('.character-select-button strong').first().textContent(),'Role 3','Off-page online role moves to top before the batch completes or saves')
 await page.evaluate(()=>window.finishPresenceQuery())
 await page.getByText(/已查询 3 人 · 当前确认在线 2 人/).waitFor()
 await advance(2000);await page.waitForFunction(()=>window.commands.length===4)
 assert.equal(await page.evaluate(()=>window.commands.at(-1).characterId),'1','Online scope queries automatically and excludes returned offline roles')
 await page.getByRole('button',{name:/^在线 · .*Role 1/}).waitFor()
 await page.getByRole('button',{name:'停止托管'}).click()
 await openSetup();await page.getByLabel('托管范围').selectOption('all');await page.getByRole('button',{name:'开启持续托管'}).click()
 await page.getByText(/3 个角色 · 已确认发送 0 条/).waitFor()
 for(let i=0;i<3;i++){await advance(i?16000:6000);await page.waitForFunction(n=>window.commands.length===n,5+i);await page.getByText(new RegExp('已确认发送 '+(i+1)+' 条')).waitFor()}
 assert.deepEqual(await page.evaluate(()=>window.commands.slice(-3).map(c=>c.characterId)),['1','2','3'])
 assert.equal(await page.getByRole('button',{name:'暂停托管'}).count(),1,'Complete first round stays active')
 mkdirSync(root+'artifacts',{recursive:true});await page.setViewportSize({width:1920,height:1080});await page.screenshot({path:root+'artifacts/managed-chat.png',fullPage:true})
 // A second tab cannot start a second scheduler for this same client.
 const other=await context.newPage();await other.goto(url);await other.getByPlaceholder('发送消息给 Role 1').waitFor();await other.locator('.managed-chat-setup summary').click()
 await other.getByRole('button',{name:'开启持续托管'}).click();await other.locator('.managed-chat-setup summary').click();await other.getByText('其他标签页正在托管此客户端，请先在那里停止').waitFor();await other.close()
 const sentBeforeOwnershipChange=await page.evaluate(()=>window.commands.length)
 lockAcquiredAt=200
 await advance(6000);await advance(1000)
 await page.getByRole('button',{name:'恢复托管'}).waitFor()
 assert.equal(await page.evaluate(()=>window.commands.length),sentBeforeOwnershipChange,'New generation pauses automatically even for the same account')
 await page.getByRole('button',{name:'恢复托管'}).click()
 await page.getByRole('button',{name:'暂停托管'}).waitFor()
 await page.evaluate(()=>window.reply('1','reply after explicit resume'))
 await advance(6000);await page.waitForFunction(n=>window.commands.length===n,sentBeforeOwnershipChange+1)
 assert.equal(calls.findLast(call=>call.forwardedProps?.surface==='managed').forwardedProps.acquiredAt,200,'Explicit resume passes the server-verified generation to the AI endpoint')
 lockOwner='b';lockAcquiredAt=300
 await advance(6000);await advance(1000)
 await page.getByRole('button',{name:'恢复托管'}).waitFor()
 await page.getByRole('button',{name:'恢复托管'}).click()
 await page.getByText('当前账号未占用此客户端，请先重新占用再恢复托管',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.commands.length),sentBeforeOwnershipChange+1,'Explicit resume cannot adopt another user’s lock')
 await page.getByRole('button',{name:'停止托管'}).click()
 assert.deepEqual(errors,[])
 console.log('PASS: real portal + SDK + SSE + MQTT receipt path; all tools; single/online/all; independent target while navigating; pause/stop; sustained rounds; cross-tab exclusion')
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
