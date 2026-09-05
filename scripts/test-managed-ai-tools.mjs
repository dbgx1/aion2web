import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const bundle=await build({stdin:{contents:`import {runManagedAiTurn} from './src/lib/managed-ai-turn';window.execute=async()=>{window.actions=[];await runManagedAiTurn({recipient:{characterId:'one',serverKey:'1001',name:'Only One'},config:{agentId:'A1',acquiredAt:100,instruction:'test',scope:'all'},reason:'reply',signal:new AbortController().signal,history:[{id:'incoming',direction:'incoming',content:'private context',time:''}],send:async content=>{window.actions.push(['send',content]);return true},queueGroup:(content,variants)=>{window.actions.push(['group',content,variants]);return 3}},{history:async()=>[],presence:async()=>{window.actions.push(['presence']);return 'online'},controlDraft:command=>window.actions.push(['control',command]),notice:text=>window.actions.push(['draft',text])})}`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'})
const tools={set_control_command_draft:{command:{type:'ping'}},set_private_chat_draft:{content:'private draft'},send_private_chat:{content:'private send'},set_group_chat_draft:{content:'group draft'},send_group_chat:{content:'group send',variants:['a','b']},get_managed_context:{},read_managed_history:{},query_managed_online:{}}
let requests=0, firstBody
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}
 if(req.url==='/api/ai/chat'){
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);firstBody??=body
  const {threadId,runId}=body;const events=[{type:'RUN_STARTED',threadId,runId}]
  if(requests++===0){
   for(const [name,input]of Object.entries(tools))events.push({type:'TOOL_CALL_START',toolCallId:name,toolCallName:name},{type:'TOOL_CALL_END',toolCallId:name,input})
   events.push({type:'RUN_FINISHED',threadId,runId,outcome:{type:'interrupt',interrupts:Object.entries(tools).map(([name,input])=>({id:'client_tool_'+name,reason:'tanstack:client_tool_execution',toolCallId:name,responseSchema:{},metadata:{kind:'client_tool',toolName:name,input}}))}})
  }else events.push({type:'TEXT_MESSAGE_START',messageId:'done',role:'assistant'},{type:'TEXT_MESSAGE_CONTENT',messageId:'done',delta:'done'},{type:'TEXT_MESSAGE_END',messageId:'done'},{type:'RUN_FINISHED',threadId,runId})
  res.setHeader('Content-Type','text/event-stream');res.end(events.map(event=>'data: '+JSON.stringify({...event,timestamp:Date.now()})+'\n\n').join(''));return
 }
 res.setHeader('Content-Type','text/html');res.end('<script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,channel:'msedge'})
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(()=>window.execute())
 const actions=await page.evaluate(()=>window.actions)
 assert.equal(actions.filter(a=>a[0]==='send').length,1)
 assert.equal(actions.filter(a=>a[0]==='group').length,1)
 assert.equal(actions.filter(a=>a[0]==='presence').length,1)
 assert.equal(actions.filter(a=>a[0]==='control').length,1)
 assert.equal(actions.filter(a=>a[0]==='draft').length,2)
 assert.equal(firstBody.forwardedProps.recentPrivateMessages[0].content,'private context')
 assert.deepEqual(firstBody.tools.map(tool=>tool.name).sort(),Object.keys(tools).sort())
 assert.equal(requests,1,'Confirmed send ends the turn without a second paid model request for a summary')
 console.log('PASS: actual SDK executes all 8 managed tools (private/group sends, both drafts, control draft, context, history, online query)')
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
