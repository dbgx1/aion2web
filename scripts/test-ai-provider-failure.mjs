import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as ai from '@tanstack/ai'
import {createOpenRouterText} from '@tanstack/ai-openrouter'
import {HTTPClient} from '@openrouter/sdk/lib/http.js'
import {z} from 'zod'
import {build} from 'esbuild'

const historyBundle=await build({entryPoints:['src/lib/ai-history.ts'],bundle:true,write:false,format:'esm',platform:'node'})
const history=await import('data:text/javascript;base64,'+Buffer.from(historyBundle.outputFiles[0].text).toString('base64'))
const contextBundle=await build({entryPoints:['src/lib/ai-context.ts'],bundle:true,write:false,format:'esm',platform:'node'})
const context=await import('data:text/javascript;base64,'+Buffer.from(contextBundle.outputFiles[0].text).toString('base64'))

const diagnostics = {}, errorLogs = []
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/ai-error-details.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:diagnostics})
assert.match(diagnostics.aiErrorMessage({error:{message:'Provider returned error'}}),/错误码：未提供/)
const safe = JSON.stringify(diagnostics.aiErrorDetails({code:502,rawEvent:{metadata:{raw:'{"error":{"message":"bad request"},"api_key":"hidden-key"}',provider_name:'fixture'},headers:{authorization:'hidden-header'},messages:['private-prompt']},message:'Bearer hidden-bearer sk-hidden-token'}))
assert.match(safe,/bad request/)
for (const hidden of ['hidden-key','hidden-header','private-prompt','hidden-bearer','sk-hidden-token']) assert.ok(!safe.includes(hidden))

let calls=0,configuration,wireBody,hasAccess=true
const tool=ai.toolDefinition({name:'draft',description:'draft only',inputSchema:z.object({text:z.string()})})
const sendPrivate=ai.toolDefinition({name:'send_private_chat',description:'fixture',inputSchema:z.object({content:z.string()})})
const sendGroup=ai.toolDefinition({name:'send_group_chat',description:'fixture',inputSchema:z.object({content:z.string()})})
const dependencies={
 '#/lib/ai-history':history,
 '#/lib/ai-context':context,
 '#/lib/ai-error-details':diagnostics,
 '@tanstack/ai':ai,
 '@tanstack/react-router':{createFileRoute:()=>value=>value},
 '@tanstack/ai-openrouter':{openRouterText:(model,config)=>{
  configuration=config
  return createOpenRouterText(model,'fake-test-key',{...config,httpClient:new HTTPClient({fetcher:async request=>{
   wireBody=await request.json()
   calls++
   return Response.json({error:{code:504,message:'Provider timed out after 5739ms'}},{status:504})
  }})})
 }},
 '#/lib/console-ai-tools':{setControlCommandDraftDef:tool,managedAiToolDefs:[tool,sendPrivate,sendGroup],sendPrivateChatDef:sendPrivate,sendGroupChatDef:sendGroup},
 '#/server/server-access.server':{canAccessServer:async(_,serverId)=>hasAccess&&serverId==='1001'},
 '#/server/admin-auth.server':{currentAdminPrincipal:async()=>({userKey:'test'})},
 '#/server/api-auth.server':{jsonError:(error,status)=>Response.json({error},{status})},
 '#/server/ai-persona.server':{getAiPersona:async()=>({}),aiPersonaPrompt:()=>''},
}
const exports={}
const env={OPENROUTER_API_KEY:'fake-test-key'}
const code=ts.transpileModule(readFileSync(new URL('../src/routes/api/ai/chat.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
runInNewContext(code,{exports,AbortController,console:{error:(...args)=>errorLogs.push(args)},process:{env},require:name=>{assert.ok(dependencies[name],name);return dependencies[name]}})
const response=await exports.Route.server.handlers.POST({request:new Request('https://test/api/ai/chat',{method:'POST',body:JSON.stringify({threadId:'test',runId:'run',messages:[{id:'test-message',role:'user',content:'connection test'}],tools:[],context:[],forwardedProps:{surface:'console'},state:{}})})})
const body=await response.text()
assert.equal(calls,1,'HTTP 504 must not trigger SDK background retries')
assert.equal(configuration.retryConfig.strategy,'none')
assert.equal(configuration.timeoutMs,45000)
assert.equal(wireBody.tool_choice,undefined,'Interactive chat may answer without a tool')
assert.equal(wireBody.model,'deepseek/deepseek-chat')
assert.match(body,/RUN_ERROR/)
assert.match(body,/5739ms/)
assert.ok(!body.includes('fake-test-key'))
assert.match(JSON.stringify(errorLogs),/504/)
assert.match(body,/requestId/)
console.log('PASS: actual route + TanStack adapter + OpenRouter SDK returns one streamed error after one HTTP 504, without retrying or exposing credentials')
const managedRequest=(extra={},messages=[{id:'test',role:'user',content:'test only'}])=>new Request('https://test/api/ai/chat',{method:'POST',body:JSON.stringify({threadId:'managed-test',runId:'managed-run',messages,tools:[],context:[],state:{},forwardedProps:{surface:'managed',agentId:'A1',serverId:'1001',...extra}})})
hasAccess=false
assert.equal((await exports.Route.server.handlers.POST({request:managedRequest()})).status,403)
hasAccess=true
assert.equal((await exports.Route.server.handlers.POST({request:managedRequest({serverId:'1003'})})).status,403)
assert.equal(calls,1,'Unauthorized or unassigned managed requests must not spend a provider call')
hasAccess=true
env.TANSTACK_AI_MODEL='deepseek/deepseek-r1'
const managedResponse=await exports.Route.server.handlers.POST({request:managedRequest()})
assert.match(await managedResponse.text(),/RUN_ERROR/)
assert.equal(calls,2)
assert.equal(wireBody.model,'deepseek/deepseek-v4-flash-0731','Managed model must not be overridden by legacy console configuration')
assert.equal(wireBody.tool_choice,'required','Managed requests require a tool on the actual OpenRouter wire')
console.log('PASS: managed AI checks assigned server permissions before contacting the provider')
await (await exports.Route.server.handlers.POST({request:managedRequest({requireChatAction:true})})).text()
assert.equal(wireBody.tool_choice,'required')
assert.deepEqual(wireBody.tools.map(tool=>tool.function.name),['send_private_chat','send_group_chat'])
await (await exports.Route.server.handlers.POST({request:managedRequest({},[
 {id:'user',role:'user',content:'test'},
 {id:'assistant',role:'assistant',toolCalls:[{id:'already',type:'function',function:{name:'send_group_chat',arguments:'{"content":"fixture"}'}}]},
 {id:'result',role:'tool',toolCallId:'already',content:'{"sent":false,"totalCount":3}'},
])})).text()
assert.equal(wireBody.tool_choice,undefined,'Older clients may summarize a queued group without being forced to send again')
console.log('PASS: recovery offers only scoped chat actions; post-action continuation never forces a second send')

const interactiveRequest=messages=>new Request('https://test/api/ai/chat',{method:'POST',body:JSON.stringify({threadId:'interactive',runId:'run',messages,tools:[],context:[],state:{},forwardedProps:{surface:'messages'}})})
dependencies['#/lib/console-ai-tools'].setPrivateChatDraftDef=tool
dependencies['#/lib/console-ai-tools'].setGroupChatDraftDef=ai.toolDefinition({name:'group_draft',description:'fixture',inputSchema:z.object({text:z.string()})})
await (await exports.Route.server.handlers.POST({request:interactiveRequest([
 {id:'u1',role:'user',content:'fixture'},
 {id:'a1',role:'assistant',toolCalls:[{id:'unfinished',type:'function',function:{name:'send_private_chat',arguments:'{"content":"fixture"}'}}]},
 {id:'u2',role:'user',content:'next'},
])})).text()
const actionIndex=wireBody.messages.findIndex(m=>m.tool_calls?.some(c=>c.id==='unfinished'))
assert.ok(actionIndex>=0)
assert.equal(wireBody.messages[actionIndex+1].tool_call_id,'unfinished')
assert.equal(JSON.parse(wireBody.messages[actionIndex+1].content).status,'unknown')
await (await exports.Route.server.handlers.POST({request:interactiveRequest(Array.from({length:100},(_,i)=>[
 {id:'u'+i,role:'user',content:'turn '+i},{id:'a'+i,role:'assistant',content:'reply'},
]).flat())})).text()
assert.equal(wireBody.messages.filter(m=>m.role==='user').length,12)
const callsBeforeLimit=calls
assert.equal((await exports.Route.server.handlers.POST({request:interactiveRequest([{id:'large',role:'user',content:'大'.repeat(30_000)}])})).status,413)
assert.equal(calls,callsBeforeLimit,'Oversized current turn must not spend a provider call')
assert.equal((await exports.Route.server.handlers.POST({request:new Request('https://test/api/ai/chat',{method:'POST',body:'{'})})).status,400)
console.log('PASS: actual provider wire repairs missing tool results, bounds 100-turn interactive history, rejects oversized/invalid requests before provider calls')
await (await exports.Route.server.handlers.POST({request:managedRequest({
 task:{instruction:'KEEP TASK INTACT',scope:'single'},
 selectedCharacter:{characterId:'one',serverKey:'1001'},
 recentPrivateMessages:Array.from({length:12},(_,i)=>({content:i===11?'LATEST QUESTION':'old'.repeat(1000)})),
})})).text()
const systemText=wireBody.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n')
assert.ok(systemText.includes('KEEP TASK INTACT'))
assert.ok(systemText.includes('LATEST QUESTION'))
const beforeContextLimit=calls
assert.equal((await exports.Route.server.handlers.POST({request:managedRequest({task:{instruction:'x'.repeat(13000)}})})).status,413)
assert.equal(calls,beforeContextLimit,'Oversized task must not be silently truncated or sent to provider')
console.log('PASS: provider wire retains persistent task and newest private question; oversized task rejects without model spend')
