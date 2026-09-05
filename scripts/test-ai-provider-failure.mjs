import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as ai from '@tanstack/ai'
import {createOpenRouterText} from '@tanstack/ai-openrouter'
import {HTTPClient} from '@openrouter/sdk/lib/http.js'
import {z} from 'zod'

let calls=0,configuration,owner='test',generation=100
const tool=ai.toolDefinition({name:'draft',description:'draft only',inputSchema:z.object({text:z.string()})})
const dependencies={
 '@tanstack/ai':ai,
 '@tanstack/react-router':{createFileRoute:()=>value=>value},
 '@tanstack/ai-openrouter':{openRouterText:(model,config)=>{
  configuration=config
  return createOpenRouterText(model,'fake-test-key',{...config,httpClient:new HTTPClient({fetcher:async()=>{
   calls++
   return Response.json({error:{code:504,message:'Provider timed out after 5739ms'}},{status:504})
  }})})
 }},
 '#/lib/console-ai-tools':{setControlCommandDraftDef:tool,managedAiToolDefs:[tool]},
 '#/server/client-locks.server':{listClientLocks:async()=>[{agentId:'A1',userKey:owner,acquiredAt:generation}]},
 '#/server/admin-auth.server':{currentAdminPrincipal:async()=>({userKey:'test'})},
 '#/server/api-auth.server':{jsonError:(error,status)=>Response.json({error},{status})},
 '#/server/ai-persona.server':{getAiPersona:async()=>({}),aiPersonaPrompt:()=>''},
}
const exports={}
const code=ts.transpileModule(readFileSync(new URL('../src/routes/api/ai/chat.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
runInNewContext(code,{exports,AbortController,process:{env:{OPENROUTER_API_KEY:'fake-test-key'}},require:name=>{assert.ok(dependencies[name],name);return dependencies[name]}})
const response=await exports.Route.server.handlers.POST({request:new Request('https://test/api/ai/chat',{method:'POST',body:JSON.stringify({threadId:'test',runId:'run',messages:[{id:'test-message',role:'user',content:'connection test'}],tools:[],context:[],forwardedProps:{surface:'console'},state:{}})})})
const body=await response.text()
assert.equal(calls,1,'HTTP 504 must not trigger SDK background retries')
assert.equal(configuration.retryConfig.strategy,'none')
assert.equal(configuration.timeoutMs,45000)
assert.match(body,/RUN_ERROR/)
assert.match(body,/5739ms/)
assert.ok(!body.includes('fake-test-key'))
console.log('PASS: actual route + TanStack adapter + OpenRouter SDK returns one streamed error after one HTTP 504, without retrying or exposing credentials')
const managedRequest=()=>new Request('https://test/api/ai/chat',{method:'POST',body:JSON.stringify({threadId:'managed-test',runId:'managed-run',messages:[{id:'test',role:'user',content:'test only'}],tools:[],context:[],state:{},forwardedProps:{surface:'managed',agentId:'A1',acquiredAt:100}})})
owner='another'
assert.equal((await exports.Route.server.handlers.POST({request:managedRequest()})).status,403)
owner='test';generation=101
assert.equal((await exports.Route.server.handlers.POST({request:managedRequest()})).status,403)
assert.equal(calls,1,'Unauthorized or obsolete managed sessions must not spend a provider call')
generation=100
const managedResponse=await exports.Route.server.handlers.POST({request:managedRequest()})
assert.match(await managedResponse.text(),/RUN_ERROR/)
assert.equal(calls,2)
console.log('PASS: managed AI checks authenticated lock owner and acquisition generation before contacting the provider')
