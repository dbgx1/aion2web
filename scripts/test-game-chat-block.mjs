import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const storage = new Map()
const exports = {}
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/game-chat-block.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}})
const {gameChatBlockFromEvent:parse,GameChatGuard,gameChatBlockMessage:message}=exports
const example={error:2011200,defined:'NET_ERR_GAME_CHAT_BLOCKED',restrictInfo:{startTime:'2026-09-05T00:41:25.050+0900',expirationTime:'2026-09-05T00:51:25.050+0900',blockedType:'BLOCKED_BY_ADMIN',reason:null}}
const receipt=error=>({type:'control_result',ok:false,error})
const now=Date.parse('2026-09-04T15:45:00Z')
const block=parse(receipt('HTTP 403 · '+JSON.stringify(example)),now)
assert.equal(block.expiresAt,Date.parse('2026-09-04T15:51:25.050Z'))
assert.match(message(block),/23:51:25/)
assert.match(message(block),/管理员/)
assert.equal(parse(receipt({response:{data:example}}),now).expiresAt,block.expiresAt)
assert.equal(parse(receipt(JSON.stringify(example).replaceAll('_','\\_')),now).expiresAt,block.expiresAt)
assert.equal(parse({type:'chat_message',content:JSON.stringify(example)},now),null)
assert.equal(parse({type:'control_sent',payload:example},now),null)
assert.equal(parse(receipt('HTTP 403 forbidden'),now),null)
assert.equal(parse(receipt(example),block.expiresAt),null)
assert.equal(parse(receipt({defined:'NET_ERR_GAME_CHAT_BLOCKED'}),now).expiresAt,null)
const future={...example,restrictInfo:{...example.restrictInfo,startTime:new Date().toISOString(),expirationTime:new Date(Date.now()+600000).toISOString()}}
const guard=new GameChatGuard();guard.setScope('room-1')
let notifications=0;guard.subscribe(()=>notifications++)
guard.accept('A1',receipt('HTTP 403 · '+JSON.stringify(future)))
assert.ok(guard.get('A1'));assert.equal(guard.get('A2'),null)
assert.equal(notifications,1,'stop signal fires synchronously')
const restored=new GameChatGuard();restored.setScope('room-1');assert.ok(restored.get('A1'))
restored.setScope('room-2');assert.equal(restored.get('A1'),null)
const longer={...future,restrictInfo:{...future.restrictInfo,expirationTime:new Date(Date.now()+1200000).toISOString()}}
const another=new GameChatGuard();another.setScope('room-1');another.accept('A1',receipt(longer));guard.reload()
assert.equal(guard.get('A1').expiresAt,Date.parse(longer.restrictInfo.expirationTime),'another tab can extend a restriction')
guard.accept('A1',receipt(future));assert.equal(guard.get('A1').expiresAt,Date.parse(longer.restrictInfo.expirationTime),'older receipt cannot shorten a ban')
console.log('PASS: exact game ban detection, nested/HTTP/escaped payloads, timezone, stale receipt rejection, generic 403/chat content isolation, synchronous notification, reload persistence and cross-tab extension')
