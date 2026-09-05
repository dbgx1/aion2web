import assert from 'node:assert/strict'
import { build } from 'esbuild'
const bundle=await build({entryPoints:['src/lib/query-managed-presence.ts'],bundle:true,write:false,format:'esm',platform:'node'})
const {queryManagedPresence}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const saved=[], events=[]
globalThis.window={dispatchEvent:event=>events.push(event)}
globalThis.fetch=async(url,options)=>{saved.push(JSON.parse(options.body));return Response.json({ok:true})}
const roles=[1,2].map(id=>({characterId:String(id),serverKey:'1001',name:'Role '+id}))
const response=(character,status)=>({serverId:'1001',characterId:character.characterId,status,checkedAt:Date.now()})
const signal=new AbortController().signal
const result=await queryManagedPresence(roles,async(targets,receive)=>{
 for(const [index,role] of roles.entries()){
  receive({type:'presence_result',requestId:'r',results:[response(role,'online')]})
  assert.equal(events.length,index+1,'Each result updates UI before the query completes')
  assert.equal(saved.length,0,'UI does not wait for database persistence')
 }
},signal)
assert.equal(result.length,2);assert.equal(saved.length,1,'streamed results are persisted in one batch');assert.equal(saved[0].results.length,2)
assert.equal(events.length,2,'No duplicate UI update after saving the batch')
const partial=await queryManagedPresence(roles,async(targets,receive)=>{
 receive({type:'presence_result',requestId:'partial',results:[response(roles[0],'online')]});throw new Error('timeout')
},signal)
assert.equal(partial.length,1,'confirmed partial results survive provider timeout')
await assert.rejects(queryManagedPresence(roles,async()=>{throw new Error('disconnected')},signal),/disconnected/)
const controller=new AbortController(), before=saved.length
const eventsBeforeCancel=events.length
await assert.rejects(queryManagedPresence(roles,async(targets,receive)=>{
 receive({type:'presence_result',requestId:'cancel',results:[response(roles[0],'online')]});controller.abort()
 receive({type:'presence_result',requestId:'cancel',results:[response(roles[1],'online')]})
},controller.signal))
assert.equal(saved.length,before,'cancelled tasks cannot save late results')
assert.equal(events.length,eventsBeforeCancel+1,'Retain results received before stop; ignore late callbacks')
console.log('PASS: batch persistence, local UI update, partial timeout, failure propagation and cancellation')
