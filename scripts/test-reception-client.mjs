import assert from 'node:assert/strict'
import { build } from 'esbuild'
const bundle = await build({ entryPoints:['src/lib/reception-client.ts','src/lib/managed-chat.ts'],bundle:true,write:false,outdir:'out',format:'esm',platform:'node' })
const modules = await Promise.all(bundle.outputFiles.map(file => import('data:text/javascript;base64,'+Buffer.from(file.text).toString('base64'))))
const { runReceptionTurn } = modules.find(m => m.runReceptionTurn), { ManagedChatRunner, managedKey } = modules.find(m => m.ManagedChatRunner)
const original = globalThis.fetch
let actions=[], sends=0, mode='sent'
const character={serverKey:'1001',characterId:'1',name:'Player'}
const config={serverId:'1001',agentId:'a1',room:'r',scope:'single',instruction:'',intervalMs:0,proactiveMs:0,reception:true}
const line={id:'one',direction:'incoming',content:'hello',time:new Date().toISOString()}
globalThis.fetch=async (_url,init)=>{
 const body=JSON.parse(init.body); actions.push(body)
 return Response.json({ok:true,...(body.action==='plan'?{status:mode==='handoff'?'skipped':'ready',turnId:crypto.randomUUID(),decision:{reply:'Hey!'}}:{}),...(body.action==='claim'?{claimed:mode!=='stale'}:{})})
}
try {
 const execute=async scenario=>{mode=scenario;actions=[];sends=0;return runReceptionTurn({config,recipient:character,reason:'reply',signal:new AbortController().signal,history:[line],send:async()=>{sends++;if(mode==='uncertain')throw new Error('receipt lost');return true}},[],()=>{})}
 await execute('sent');assert.equal(sends,1);assert.equal(actions.at(-1).outcome,'sent')
 await execute('stale');assert.equal(sends,0);assert.equal(actions.length,2)
 await execute('handoff');assert.equal(sends,0);assert.equal(actions.length,1)
 await assert.rejects(execute('uncertain'),/receipt lost/);assert.equal(sends,1);assert.equal(actions.at(-1).outcome,'uncertain')
 let now=0,runs=0
 const runner=new ManagedChatRunner({now:()=>now,guard:()=>null,verify:async()=>{},changed:()=>{},send:async()=>{},run:async()=>{runs++}})
 await runner.start(config,async()=>[character]);now=10000;await runner.tick();assert.equal(runs,0)
 runner.observe(managedKey(character),line);now+=1000;await runner.tick();assert.equal(runs,1)
 now+=1000000;await runner.tick();assert.equal(runs,1)
 runner.observe(managedKey(character),line);now+=1000;await runner.tick();assert.equal(runs,1)
 console.log('PASS: reception client plan/claim/receipt lifecycle, no sends for handoff or stale claims, no transport retry, reply-only scheduler and duplicate input suppression')
} finally {globalThis.fetch=original}
