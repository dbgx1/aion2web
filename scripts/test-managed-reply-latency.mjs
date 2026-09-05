import assert from 'node:assert/strict'
import { build } from 'esbuild'
const bundle=await build({entryPoints:['src/lib/managed-chat.ts'],bundle:true,write:false,format:'esm',platform:'node'})
const {ManagedChatRunner,managedKey}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const roles=[1,2].map(id=>({characterId:String(id),serverKey:'1001',name:'Role '+id}))
const config={agentId:'A',room:'r',acquiredAt:1,scope:'single',intervalMs:0,proactiveMs:600000}
let now=1000000, sends=[], queries=0, run, query, send, activeSignal
const runner=new ManagedChatRunner({now:()=>now,changed:()=>{},guard:()=>null,verify:async()=>{},
 queryOnline:async(roles,signal)=>{queries++;return query(roles,signal)},
 run:async turn=>run?run(turn):turn.send('reply'),
 send:async(c,role,text,signal)=>{sends.push([role.characterId,text,now]);if(send)await send(signal)},
})
const incoming=(id,role=roles[0])=>runner.observe(managedKey(role),{id,direction:'incoming',content:id,time:''})
await runner.start(config,async()=>[roles[0]]);now+=5000
incoming('first');now+=300;incoming('second');now+=199;await runner.tick();assert.equal(sends.length,0)
now+=1;await runner.tick();assert.equal(sends.length,1,'Reply is eligible 500 ms after first line, not five seconds after last line')
assert.equal(queries,0,'Single conversation never performs a presence scan')

await runner.start(config,async()=>[roles[0]]);now+=5000
run=turn=>new Promise(resolve=>{activeSignal=turn.signal;turn.signal.addEventListener('abort',resolve,{once:true})})
const stale=runner.tick();await new Promise(resolve=>setImmediate(resolve));incoming('new question')
assert.equal(activeSignal.aborted,true,'New message cancels an unsent stale proactive answer')
await stale;assert.equal(runner.snapshot.status,'running')
run=undefined;now+=500;await runner.tick();assert.equal(sends.length,2)

// A receipt in flight is never cancelled or retried on a new private message.
await runner.start(config,async()=>[roles[0]]);now+=5000;let acknowledge
send=signal=>new Promise(resolve=>{activeSignal=signal;acknowledge=resolve})
const sending=runner.tick();await new Promise(resolve=>setImmediate(resolve));incoming('during receipt')
assert.equal(activeSignal.aborted,false);acknowledge();await sending;send=undefined
assert.equal(runner.snapshot.status,'running')

// Global spacing starts at receipt, not after an unnecessary model postamble.
await runner.start({...config,intervalMs:3000},async()=>[roles[0]]);now+=5000
run=async turn=>{await turn.send('confirmed');now+=20000}
await runner.tick();incoming('after slow postamble');run=undefined;now+=500
const count=sends.length;await runner.tick();assert.equal(sends.length,count+1,'No extra cooldown after a delayed AI completion')

// Background scan remains unresolved while a scoped fresh private message is answered.
await runner.start({...config,scope:'online'},async()=>roles);now+=5000;let completeScan
query=()=>new Promise(resolve=>{completeScan=resolve})
const scan=runner.tick();await new Promise(resolve=>setImmediate(resolve));incoming('while scanning',roles[1]);now+=500
const beforeScanReply=sends.length;await runner.tick()
assert.equal(sends.length,beforeScanReply+1);assert.equal(sends.at(-1)[0],'2')
assert.equal(runner.snapshot.queried,undefined,'Reply does not forge queried online status')
completeScan(roles.map(role=>({serverId:'1001',characterId:role.characterId,status:'offline',checkedAt:now})));await scan
runner.stop()

// New chat must not bypass provider rate-limit backoff.
await runner.start(config,async()=>[roles[0]]);now+=5000;run=async()=>{throw new Error('429 rate limited')}
await runner.tick();const retryAt=runner.snapshot.retryAt;incoming('during backoff');now+=500
await runner.tick();assert.equal(runner.snapshot.retryAt,retryAt);assert.equal(runner.snapshot.status,'waiting')
runner.stop()
console.log('PASS: 500ms reply coalescing; no single-role presence queries; obsolete AI cancelled; receipts protected; cooldown from receipt; reply during 180s scan; rate-limit backoff retained')
