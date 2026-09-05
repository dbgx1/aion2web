import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const root=fileURLToPath(new URL('../',import.meta.url))
const source=readFileSync(root+'src/routes/index.tsx','utf8').replace('const consoleApi = useAionConsole()','const consoleApi = useAionConsole(); window.fixtureApi = consoleApi')
const fixture=`import {createRoot} from 'react-dom/client';createRoot(document.getElementById('root')).render(<AuthenticatedHome section="messages" user={{userKey:'a',username:'Alice',role:'agent'}} onLogout={()=>{}}/>);`
const bundle=await build({stdin:{contents:source+fixture,resolveDir:root+'src/routes',loader:'tsx'},bundle:true,write:false,outdir:'fixture',platform:'browser',format:'iife',jsx:'automatic',alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'},logLevel:'silent',plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/^(@tanstack\/react-router|mqtt)$/},args=>({path:args.path,namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({resolveDir:root,loader:'tsx',contents:args.path==='mqtt'?`
  export function connect(){const handlers=new Map();const client={connected:true,on(type,fn){handlers.set(type,fn);if(type==='connect')setTimeout(fn,0);return client},subscribe(topics,callback){callback?.()},end(){client.connected=false},publish(topic,json){const value=JSON.parse(json);if(value.type==='discover')window.heartbeat();else if(topic.includes('/control/'))(window.commands||=[]).push(value)}};
   window.receipt=(agent,error)=>handlers.get('message')('aion2-chat-bridge/aion2-local/events/'+agent+'/chat',new TextEncoder().encode(JSON.stringify({type:'control_result',ok:false,agentId:agent,requestId:'test-'+crypto.randomUUID(),error,time:new Date().toISOString()})));
   window.heartbeat=()=>handlers.get('message')('aion2-chat-bridge/aion2-local/agents/A1/status',new TextEncoder().encode(JSON.stringify({type:'agent_status',agentId:'A1',host:'A1',room:'aion2-local',serverId:'1001',status:'online',time:new Date().toISOString()})));
   return client;
  }
 `:`import React from 'react';export const createFileRoute=()=>v=>v;export const useNavigate=()=>()=>{};export const Link=({children,to,...props})=><a href={to} {...props}>{children}</a>;`}))
}}]})
const characters=Array.from({length:3},(_,i)=>({id:i+1,characterId:String(i+1),characterName:'Role '+(i+1),serverId:'1001',serverName:'Test',legionName:'',className:'',level:1,faction:'',avatarUrl:'',lastSeenAt:0}))
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(x=>x.path.endsWith('.js')).text);return}
 if(req.url.startsWith('/api/')){
  let body={ok:true,characters,servers:[],messages:[],nextCursor:null,totalCount:3,locks:[{agentId:'A1',userKey:'a',username:'Alice',acquiredAt:100,expiresAt:0}]}
  if(req.url==='/api/messages'&&req.method==='POST'){let raw='';for await(const part of req)raw+=part;body={ok:true,conversations:JSON.parse(raw).conversations.map(c=>({ok:true,serverId:c.serverId,characterId:c.characterId,received:c.messages.length}))}}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return
 }
 res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:'msedge'})
try {
 const context=await browser.newContext();await context.addInitScript(()=>localStorage.setItem('aion2-selected-agent-id','A1'))
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 const url=`http://127.0.0.1:${server.address().port}`
 await page.goto(url);await page.getByPlaceholder('发送消息给 Role 1').waitFor()
 await page.locator('.broadcast-character').click();await page.getByPlaceholder('发送给筛选结果中的 3 个角色').fill('test only')
 await page.getByLabel('群发间隔最小毫秒').fill('1000');await page.getByLabel('群发间隔最大毫秒').fill('1000')
 await page.clock.install()
 await page.getByRole('button',{name:'发送给 3 人',exact:true}).click()
 await page.waitForFunction(()=>window.commands?.filter(c=>c.type==='sendWhisper').length===1)
 const expires=await page.evaluate(()=>{
   const expirationTime=new Date(Date.now()+600000).toISOString();window.receipt('A1','HTTP 403 · '+JSON.stringify({error:2011200,defined:'NET_ERR_GAME_CHAT_BLOCKED',restrictInfo:{startTime:new Date().toISOString(),expirationTime,blockedType:'BLOCKED_BY_ADMIN',reason:null}}));
   // Ref guard must reject another publish in the same event loop, before React renders.
   window.blockedDirect=window.fixtureApi.sendCommand('A1',{type:'sendWhisper',content:'must not publish'});
   return expirationTime;
 })
 await page.getByRole('alert').filter({hasText:'游戏聊天已被封禁'}).waitFor()
 assert.equal(await page.evaluate(()=>window.blockedDirect),false)
 await page.clock.runFor(1500)
 assert.equal(await page.evaluate(()=>window.commands.filter(c=>c.type==='sendWhisper').length),1)
 assert.equal(await page.getByRole('button',{name:'继续群发',exact:true}).isDisabled(),true)
 assert.equal(await page.evaluate(()=>window.fixtureApi.sendCommand('A1',{type:'ping'})),true,'non-chat commands remain available')
 assert.equal(await page.evaluate(()=>window.fixtureApi.sendCommand('A2',{type:'sendWhisper',content:'other test client'})),true,'another client is independent')
 const other=await context.newPage();await other.goto(url);await other.getByRole('alert').filter({hasText:'游戏聊天已被封禁'}).waitFor();await other.close()
 // Expiration changes availability, but does not restart the paused task.
 await page.clock.setSystemTime(new Date(Date.parse(expires)+1000));await page.evaluate(()=>window.heartbeat())
 await page.waitForFunction(()=>document.querySelector('.bulk-task-banner button')?.disabled===false || !window.fixtureApi.chatGuard.get('A1'))
 assert.equal(await page.evaluate(()=>window.commands.filter(c=>c.type==='sendWhisper'&&c.target==='A1').length),1)
 await page.getByRole('button',{name:'继续群发',exact:true}).click();await page.clock.runFor(1200)
 await page.waitForFunction(()=>window.commands.filter(c=>c.type==='sendWhisper'&&c.target==='A1').length===3)
 assert.deepEqual(await page.evaluate(()=>window.commands.filter(c=>c.type==='sendWhisper'&&c.target==='A1').map(c=>c.characterId)),['1','2','3'],'resume skips commands already submitted')
 assert.deepEqual(errors,[])
 console.log('PASS: real portal + real MQTT hook stop bulk on ban receipt, reject publish synchronously, disable resume, persist on remount, isolate clients, and require manual resume after expiry')
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
