import assert from 'node:assert/strict'
import { build } from 'esbuild'
const bundle = await build({ entryPoints:['src/lib/managed-chat.ts'], bundle:true, write:false, format:'esm', platform:'node' })
const { ManagedChatRunner, managedKey } = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const characters = ['1','2','3'].map(characterId=>({characterId,serverKey:'1001',name:'Role '+characterId}))
const config = {agentId:'A1',agentName:'A1',room:'r',acquiredAt:1,scope:'all',label:'all',instruction:'chat',intervalMs:15000,proactiveMs:180000}
let now=1000000, sends=[], turns=[], guard=null, runOverride, sendOverride
const runner = new ManagedChatRunner({now:()=>now, changed:()=>{}, guard:()=>guard, verify:async()=>{},
  send:async(c,who,content,signal)=>{signal.throwIfAborted();if(sendOverride)return sendOverride(c,who,content,signal);sends.push([who.characterId,content])},
  run:async turn=>{turns.push(turn);if(runOverride)return runOverride(turn);await Promise.all([turn.send('reply'),turn.send('duplicate')])},
})
await runner.start(config,async()=>characters)
runner.observe(managedKey(characters[2]),{id:'old',direction:'incoming',content:'old',time:''},false)
now+=5000;await runner.tick()
assert.deepEqual(sends,[['1','reply']],'simultaneous/repeated tools send once')
runner.observe(managedKey(characters[2]),{id:'new',direction:'incoming',content:'new',time:''})
runner.observe(managedKey(characters[2]),{id:'new',direction:'incoming',content:'new',time:''})
runner.observe('["1001","other"]',{id:'other',direction:'incoming',content:'outside',time:''})
now+=15000;await runner.tick()
assert.equal(sends.at(-1)[0],'3','incoming reply takes priority over proactive queue')
assert.deepEqual(turns.at(-1).history.map(line=>line.content),['old','new'])
now+=15000;await runner.tick();assert.equal(sends.at(-1)[0],'2')
now+=180000;await runner.tick();assert.equal(runner.snapshot.status,'running','finishing a round does not stop task')
runner.pause();const paused=sends.length;now+=500000;await runner.tick();assert.equal(sends.length,paused)
runner.resume();now+=5000;await runner.tick();assert.equal(sends.length,paused+1)
guard={message:'network',permanent:false};now+=15000;await runner.tick();assert.equal(runner.snapshot.status,'waiting')
guard=null;now+=180000;await runner.tick();assert.equal(runner.snapshot.status,'running')
guard={message:'封禁',permanent:true};now+=15000;await runner.tick();assert.equal(runner.snapshot.status,'paused')
guard=null;now+=500000;await runner.tick();assert.equal(runner.snapshot.status,'paused','ban expiry does not silently resume')
runner.stop()

// A late generated answer must not overwrite a newer incoming message.
sends=[];let release
runOverride=turn=>new Promise(resolve=>{release=async()=>{await assert.rejects(turn.send('stale'),{name:'AbortError'});resolve()}})
await runner.start(config,async()=>[characters[0]])
now+=5000;const inflight=runner.tick();await new Promise(resolve=>setImmediate(resolve))
runner.observe(managedKey(characters[0]),{id:'newer',direction:'incoming',content:'newer question',time:''})
await release();await inflight;assert.equal(sends.length,0)
runOverride=undefined;now+=15000;await runner.tick();assert.equal(sends.length,1)
assert.equal(turns.at(-1).reason,'reply')

// A non-ban send failure retries the exact text even if the AI SDK catches its tool exception.
runner.stop();sends=[];const attempts=[]
sendOverride=(c,who,content)=>{attempts.push([who.characterId,content]);if(attempts.length===1)throw new Error('[SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol')}
runOverride=async turn=>{try{await turn.send('uncertain')}catch{} }
await runner.start(config,async()=>characters);now+=5000;await runner.tick()
assert.equal(runner.snapshot.status,'waiting');assert.equal(runner.snapshot.retryAt,now+60000)
const generated=turns.length
now+=59000;await runner.tick();assert.equal(attempts.length,1)
now+=1000;await runner.tick();assert.deepEqual(attempts,[['1','uncertain'],['1','uncertain']])
assert.equal(turns.length,generated,'transport retry reuses the saved text without another AI turn')
assert.equal(runner.snapshot.sent,1);assert.equal(runner.snapshot.status,'running')
sendOverride=undefined;runOverride=()=>{throw new Error('429')};now+=15000;await runner.tick()
assert.equal(runner.snapshot.retryAt,now+60000);const count=turns.length
now+=59000;await runner.tick();assert.equal(turns.length,count)
now+=1000;await runner.tick();assert.equal(runner.snapshot.retryAt,now+120000)

// A confirmed game-chat ban pauses and never schedules the rejected text.
runner.stop();guard=null;attempts.length=0
sendOverride=(c,who,content)=>{attempts.push([who.characterId,content]);guard={message:'游戏聊天已被封禁（错误码 2011200）',permanent:true};throw new Error('客户端发送失败')}
runOverride=async turn=>{try{await turn.send('blocked')}catch{} }
await runner.start(config,async()=>characters);now+=5000;await runner.tick()
assert.equal(runner.snapshot.status,'paused');assert.equal(runner.snapshot.retryAt,0)
now+=500000;await runner.tick();assert.equal(attempts.length,1)
guard=null

// Group tool enqueues the fixed scope once; all members including current get sent.
runner.stop();sends=[];sendOverride=undefined;runOverride=async turn=>{assert.equal(turn.queueGroup('group',['a','b']),3);assert.equal(turn.queueGroup('duplicate'),0)}
await runner.start(config,async()=>characters);now+=5000;await runner.tick()
for(let i=0;i<3;i++){now+=15000;await runner.tick()}
assert.deepEqual(sends.map(([id])=>id).sort(),['1','2','3'])
assert.equal(runner.snapshot.sent,3)
runner.stop()

// Stop during recipient loading cannot resurrect a task.
runOverride=undefined;sends=[]
await runner.start({...config,intervalMs:0,proactiveMs:0},async()=>[characters[0]])
now+=5000;await runner.tick();assert.equal(sends.length,1)
runner.observe(managedKey(characters[0]),{id:'human-zero',direction:'outgoing',content:'human reply',time:''})
await runner.tick();assert.equal(sends.length,2,'Zero intervals stay zero after new messages, rather than falling back to ten minutes')
runner.stop()

let loaded;const starting=runner.start(config,()=>new Promise(resolve=>loaded=resolve))
await new Promise(resolve=>setImmediate(resolve));runner.stop();loaded(characters);await starting
assert.equal(runner.snapshot.status,'idle')
console.log('PASS: continuous rounds, isolated histories, reply priority, duplicate tool suppression, stale answer suppression, pause/resume, network recovery, confirmed-ban pause, exact-text resend, rate-limit backoff, bounded group queue, cancelled loading')
