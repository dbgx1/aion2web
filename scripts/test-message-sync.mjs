import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const { outputText } = ts.transpileModule(readFileSync(new URL('../src/lib/message-sync.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const exports = {}
runInNewContext(outputText, { exports, TextEncoder })
const { packMessageSync, messageSyncBody, MESSAGE_SYNC_MAX_BYTES } = exports
function group(count, content = '你好🌍"\\\n', characterId = 'role') {
  return { serverId: '1001', characterId,
    sourceMessages: Array.from({length:count},(_,id)=>`${characterId}-${id}`),
    messages: Array.from({length:count},(_,id)=>({sourceMessageId:`${characterId}-${id}`,content,direction:'incoming',sentAt:id+1})),
  }
}
function check(groups) {
  const result = packMessageSync(groups)
  const expected = groups.flatMap(g=>g.sourceMessages).filter(id=>!result.rejected.includes(id))
  assert.deepEqual(Array.from(result.chunks.flat(2).flatMap(g=>g.sourceMessages)), expected)
  for (const chunk of result.chunks) {
    const body = messageSyncBody(chunk)
    assert.ok(Buffer.byteLength(body,'utf8') <= MESSAGE_SYNC_MAX_BYTES)
    assert.ok(chunk.length <= 25)
    assert.ok(chunk.reduce((n,g)=>n+g.messages.length,0) <= 100)
    for (const entry of chunk) {
      assert.ok(entry.messages.length > 0 && entry.messages.length <= 50)
      assert.equal(entry.messages.length,entry.sourceMessages.length)
    }
    assert.equal(JSON.parse(body).conversations[0].sourceMessages,undefined)
  }
  return result
}
test('message bursts are preserved across group, request and UTF-8 byte limits',()=>{
  assert.equal(check([group(500)]).chunks.length,5)
  assert.equal(check(Array.from({length:80},(_,i)=>group(1,'small',String(i)))).chunks.length,4)
  assert.ok(check([group(100,'你好🌍"\\\n'.repeat(5000))]).chunks.length > 5)
})
test('oversize raw is isolated without losing neighbouring messages or retrying an impossible body',()=>{
  const input=group(3)
  input.messages[1].raw={payload:'界'.repeat(MESSAGE_SYNC_MAX_BYTES)}
  const result=check([input])
  assert.deepEqual(Array.from(result.rejected),['role-1'])
  assert.equal(result.chunks.length,1)
  assert.deepEqual(Array.from(packMessageSync([]).chunks),[])
})
test('exact byte boundary accounts for envelope, JSON escapes and non-ASCII identifiers',()=>{
  const input=group(1,'','角色"\\')
  const base=Buffer.byteLength(messageSyncBody([input]))
  input.messages[0].content='a'.repeat(MESSAGE_SYNC_MAX_BYTES-base)
  assert.equal(Buffer.byteLength(messageSyncBody([input])),MESSAGE_SYNC_MAX_BYTES)
  assert.equal(check([input]).rejected.length,0)
  input.messages[0].content+='a'
  assert.equal(check([input]).rejected.length,1)
})

test('message API cancels an oversize stream without Content-Length before any database access',async()=>{
  const routeExports={}
  const deps={
    '@tanstack/react-router':{createFileRoute:()=>options=>options},
    '#/server/admin-auth.server':{currentAdminPrincipal:async()=>({userKey:'test'})},
    '#/server/api-auth.server':{jsonError:(error,status)=>Response.json({error},{status})},
    '#/server/messages.server':{storeMessages:()=>assert.fail('Oversize input must not reach D1')},
  }
  const compiled=ts.transpileModule(readFileSync(new URL('../src/routes/api/messages.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  runInNewContext(compiled.outputText,{exports:routeExports,TextDecoder,Response,require:name=>{
    assert.ok(Object.hasOwn(deps,name));return deps[name]
  }})
  let pulls=0,canceled=false
  const stream=new ReadableStream({
    pull(controller){pulls++;controller.enqueue(new Uint8Array(64*1024))},
    cancel(){canceled=true},
  })
  const request=new Request('https://example.test/api/messages',{method:'POST',body:stream,duplex:'half'})
  const response=await routeExports.Route.server.handlers.POST({request})
  assert.equal(response.status,413)
  assert.equal(canceled,true)
  assert.ok(pulls<=10,'Stop consuming instead of buffering the unbounded request')
})
