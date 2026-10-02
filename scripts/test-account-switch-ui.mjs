import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const bundle=await build({stdin:{contents:`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{AccountSwitchPanel}from'./src/components/account-switch-panel';
window.sent=[];
function Fixture(){const[messages,setMessages]=useState([]),[connected,setConnected]=useState(true);
window.event=(raw,agentId='agent')=>setMessages(x=>[...x,{id:crypto.randomUUID(),agentId,type:raw.type,raw}]);
window.connection=setConnected;
return <AccountSwitchPanel agentId="agent" connected={connected} messages={messages} storageKey="fixture" onSend={(id,command)=>{window.sent.push({id,...command});return true}}/>}
createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}})
const server=createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(readFileSync('src/styles.css'));return}res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="padding:20px"><div id="root"></div><script src="/bundle.js"></script></body>')})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:'msedge'})
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByLabel('目标账号引用').fill('account-03');await page.getByLabel('目标区服 ID').fill('1001');await page.getByLabel('目标角色 ID').fill('char1')
 await page.getByRole('button',{name:'发送换号指令'}).click()
 const sent=await page.evaluate(()=>window.sent.find(x=>x.type==='switchAccount'));assert.ok(sent.taskId);assert.equal(sent.serverKey,'1001')
 const snapshot={taskId:sent.taskId,revision:1,state:'received',accountRef:'account-03',serverId:'1001',characterId:'char1',updatedAt:Date.now(),chatPaused:true}
 const emit=async(patch,agent='agent')=>page.evaluate(({value,agent})=>window.event({type:'control_progress',command:'switchAccount',switchTask:value},agent),{value:{...snapshot,...patch},agent})
 await emit({});await page.getByRole('heading',{name:'客户端已收到',exact:true}).waitFor()
 await emit({revision:2,state:'running',stage:'authenticating'});await page.getByRole('heading',{name:'正在换号',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'发送换号指令'}).isDisabled(),true)
 await emit({revision:1,state:'received'});await emit({revision:99,state:'failed'},'other-agent')
 assert.equal(await page.getByRole('heading',{name:'正在换号',exact:true}).isVisible(),true)
 await page.evaluate(()=>window.connection(false));await page.getByRole('heading',{name:'状态未确认',exact:true}).waitFor()
 await page.evaluate(()=>window.connection(true));await page.reload()
 await page.waitForFunction(()=>window.sent.some(x=>x.type==='switchAccountStatus'))
 assert.equal(await page.evaluate(()=>window.sent.filter(x=>x.type==='switchAccount').length),0)
 await emit({revision:3,state:'waiting_user',message:'请在登录窗口完成验证'});await page.getByRole('heading',{name:'等待人工处理',exact:true}).waitFor()
 await emit({revision:4,state:'succeeded',stage:'entering_world'});await page.getByRole('heading',{name:'换号成功',exact:true}).waitFor()
 await page.screenshot({path:'artifacts/account-switch-desktop.png',fullPage:true})
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/account-switch-mobile.png',fullPage:true})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(errors,[])
 console.log('PASS: switch UI dispatch, live progress, wrong-agent/stale-event isolation, disconnect state, refresh query without replay, waiting-user and mobile layout')
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
