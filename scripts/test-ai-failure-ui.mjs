import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import {build} from 'esbuild'

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const root=new URL('../',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')
const source=readFileSync(new URL('../src/routes/index.tsx',import.meta.url),'utf8')
const fixture=`
 import {createRoot} from 'react-dom/client'
 const noop=()=>{}, agent={agentId:'test',host:'test'};
 const props={agent,recipientMode:'single',selectedFilterLabel:'test',recipientCount:0,content:'',chronologicalMessages:[],publicMessages:[],bulkIntervalRangeMs:{min:1000,max:1000},onContentChange:noop,onSendPrivateChat:()=>{throw Error('Unexpected game command')},onSendGroupChat:()=>{throw Error('Unexpected game command')},onRecipientModeChange:noop,onMessageViewChange:noop};
 createRoot(document.getElementById('root')).render(location.pathname==='/console'
  ?<ConsoleAiAssistant agents={[]} selectedAgent={agent} serverNames={new Map()} commandText="" onApplyCommand={noop}/>
  :<MessageAiAssistant {...props}/>);
`
const bundle=await build({stdin:{contents:source+fixture,resolveDir:root+'src/routes',loader:'tsx'},bundle:true,write:false,outdir:'fixture',platform:'browser',format:'iife',jsx:'automatic',alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'},logLevel:'silent'})
let fail=true,requests=0,rateLimited=false
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);return}
 if(req.url==='/api/ai/chat'){
  requests++;let body='';for await(const chunk of req)body+=chunk
  const {threadId,runId}=JSON.parse(body)
  const events=fail?[rateLimited
   ? {type:'RUN_ERROR',message:'Provider returned error',rawEvent:{code:429,message:'Provider returned error',metadata:{provider_name:'StreamLake',raw:'upstream shared pool rate limit'}}}
   : {type:'RUN_ERROR',message:'Provider timed out after 5739ms',code:'504'}]:[
   {type:'RUN_STARTED',threadId,runId},{type:'TEXT_MESSAGE_START',messageId:'reply',role:'assistant'},
   {type:'TEXT_MESSAGE_CONTENT',messageId:'reply',delta:'连接正常'},
   {type:'TEXT_MESSAGE_END',messageId:'reply'},{type:'RUN_FINISHED',threadId,runId}]
  res.setHeader('Content-Type','text/event-stream');res.end(events.map(event=>'data: '+JSON.stringify({...event,timestamp:Date.now()})+'\n\n').join(''));return
 }
 res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'})
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 for(const path of ['/messages','/console']){
  fail=true;rateLimited=false;const before=requests
  await page.goto(`http://127.0.0.1:${server.address().port}${path}`)
  await page.locator('textarea').fill('连接诊断')
  await page.getByRole('button',{name:'询问 AI',exact:true}).click()
  await page.getByText('AI 服务响应超时，请稍后手动重试；如涉及发送，请先核对聊天记录。',{exact:true}).waitFor()
  assert.equal(await page.locator('textarea').inputValue(),'连接诊断','RUN_ERROR resolves sendMessage but must retain prompt')
  assert.equal(await page.locator('.console-ai-message.is-assistant').count(),0,'Failure before content must not render an empty bubble')
  assert.equal(requests,before+1)
  rateLimited=true
  await page.getByRole('button',{name:'询问 AI',exact:true}).click()
  await page.getByText('AI 服务商当前限流（429），请稍后手动重试；如涉及发送，请先核对聊天记录。',{exact:true}).waitFor()
  assert.equal(await page.locator('textarea').inputValue(),'连接诊断')
  assert.equal(requests,before+2,'Nested provider error remains one explicit request')
  fail=false
  await page.getByRole('button',{name:'询问 AI',exact:true}).click()
  await page.getByText('连接正常',{exact:true}).waitFor()
  await page.waitForFunction(()=>document.querySelector('textarea').value==='')
  assert.equal(requests,before+3,'Only explicit resubmission retries')
 }
 assert.deepEqual(errors,[])
 console.log('PASS: real AI hook/SSE preserves failed prompt, hides empty bubbles, recognizes timeout and nested upstream 429, and allows explicit recovery in both panels')
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
