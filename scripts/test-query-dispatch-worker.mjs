import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'
import { z } from 'zod'
let now=1000000, alarm=null, publishOk=true, noSubscribers=false
const database=new DatabaseSync(':memory:');const published=[]
const ctx={storage:{sql:{exec(sql,...args){const s=database.prepare(sql);return {toArray:()=>s.all(...args)}}},getAlarm:async()=>alarm,setAlarm:async n=>{alarm=n},deleteAlarm:async()=>{alarm=null}}}
ctx.storage.transactionSync=fn=>{database.exec('BEGIN');try{const result=fn();database.exec('COMMIT');return result}catch(error){database.exec('ROLLBACK');throw error}}
// DO SQL executes immediately, unlike the lazy iterator returned to callers.
ctx.storage.sql.exec=(sql,...args)=>{const s=database.prepare(sql);if(/^SELECT/i.test(sql)){const rows=s.all(...args);return {toArray:()=>rows}}s.run(...args);return {toArray:()=>[]}}
const env={SERVICE_ID:'aion2web',DAILY_QUERY_LIMIT:'20000',WEBHOOK_TOKEN:'w'.repeat(40),ADMIN_TOKEN:'a'.repeat(40),MQTT_PUBLISH_URL:'https://broker.invalid/api/v5/publish',MQTT_API_KEY:'test-key',MQTT_API_SECRET:'test-secret',DB:{prepare(){return {bind(requestId){return {first:async()=>requestId==='request1'?{id:'request1',user_key:'u1',service_id:'aion2web',characters_json:JSON.stringify([{serverId:'1005',characterId:'123'}]),expires_at:1180000}:null}}}}}}
class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env}}
const globals={crypto:globalThis.crypto,Request,Response,URL,AbortSignal,TextEncoder,TextDecoder,Uint8Array,btoa,console,Date:class extends Date{static now(){return now}},fetch:async(url,options)=>{assert.equal(String(url),env.MQTT_PUBLISH_URL);const body=JSON.parse(options.body);assert.equal(body.retain,false);assert.equal(body.qos,1);published.push(body);return Response.json(noSubscribers?{message:'no_matching_subscribers',reason_code:16}:{id:'test-message-id'},{status:noSubscribers?202:publishOk?200:503})}}
function load(file,deps){const exports={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{...globals,exports,require:name=>{assert.ok(name in deps,name);return deps[name]}});return exports}
const core=load('query-dispatch/core.ts',{});const worker=load('query-dispatch/worker.ts',{'cloudflare:workers':{DurableObject},zod:{z},'./core':core})
const verified=[]
const requestPrepare=env.DB.prepare.bind(env.DB)
env.DB.prepare=sql=>!sql.startsWith('SELECT id,user_key')?{bind:(...args)=>({sql,args})}:requestPrepare(sql)
env.DB.batch=async statements=>{verified.push(...statements.filter(s=>s.sql.startsWith('INSERT OR IGNORE INTO presence_verified_results')).map(s=>s.args));return []}
let pool=new worker.QueryPool(ctx,env);env.POOL={getByName(name){assert.equal(name,'unified-query-pool');return pool}}
const send=body=>worker.default.fetch(new Request('https://dispatch.invalid/mqtt/events',{method:'POST',headers:{authorization:`Bearer ${env.WEBHOOK_TOKEN}`},body:JSON.stringify(body)}),env)
const node={clientId:'a',sessionId:'s1',gameSessionId:'g1',serverId:'1005',boot:1,seq:1,ready:true,cooldownMs:0}
const state={topic:'aion2/query-workers/a/s1/state',username:'query-a',clientid:'query-a-s1',payload:node}
assert.equal((await worker.default.fetch(new Request('https://dispatch.invalid/status'),env)).status,401)
assert.equal((await send({...state,username:'shared-browser'})).status,403,'browser cannot impersonate device')
assert.equal((await send(state)).status,200)
assert.equal((await send({topic:'aion2/presence/aion2web/requests',username:'browser',clientid:'browser',payload:{requestId:'missing'}})).status,410)
publishOk=false
assert.equal((await send({topic:'aion2/presence/aion2web/requests',username:'browser',clientid:'browser',payload:{requestId:'request1',characters:[{serverId:'evil',characterId:'456'}],replyTopic:'arbitrary'}})).status,200)
assert.equal(published.length,1)
const task=JSON.parse(published[0].payload);assert.equal(task.characterId,'123','target loaded from authorized database request')
assert.equal(alarm,now+5000)
const stored=JSON.parse(database.prepare('SELECT payload FROM scheduler_state WHERE id=1').get().payload)
assert.equal(Object.values(stored.jobs)[0].attempt.id,task.attemptId,'lease persists before failed publish')
pool=new worker.QueryPool(ctx,env);publishOk=true;noSubscribers=true;now+=5000;await pool.alarm()
assert.equal(JSON.parse(database.prepare('SELECT payload FROM scheduler_state WHERE id=1').get().payload).outbox.length,1,'202 no matching subscriber is NOT delivery confirmation')
noSubscribers=false;now+=5000;await pool.alarm()
assert.equal(JSON.parse(published[1].payload).attemptId,task.attemptId,'restart retries same delivery without fresh game task')
noSubscribers=true
assert.equal((await send({topic:'aion2/query-workers/a/s1/events',username:'query-a',clientid:'query-a-s1',payload:{taskId:task.taskId,attemptId:task.attemptId,gameSessionId:'g1',type:'completed',status:'online'}})).status,200)
const reply=published.find(p=>p.topic==='aion2/presence/aion2web/results/request1');assert.ok(reply)
assert.equal(JSON.parse(reply.payload).results[0].status,'online')
assert.equal(verified[0][0],'request1');assert.equal(verified[0][3],'online','trusted proof is stored before result publication')
const proofWrites=verified.length
pool=new worker.QueryPool(ctx,env);noSubscribers=false;now+=5000;await pool.alarm()
assert.equal(verified.length,proofWrites,'restart and publish retry reuse committed proof instead of repeating D1 writes')
const before=published.length
await send({topic:'aion2/query-workers/a/s1/events',username:'query-a',clientid:'query-a-s1',payload:{taskId:task.taskId,attemptId:task.attemptId,gameSessionId:'g1',type:'completed',status:'offline'}})
assert.equal(published.length,before,'duplicate completion cannot overwrite')
now=1190001;await pool.alarm();assert.equal(alarm,null,'no permanent polling alarm after request cleanup')
assert.equal((await send(state)).status,200)
assert.equal(Object.keys(JSON.parse(database.prepare('SELECT payload FROM scheduler_state WHERE id=1').get().payload).nodes).length,0,'late old readiness cannot resurrect a pruned node')
assert.equal((await send({...state,payload:{bad:true}})).status,400,'malformed events are not retried as temporary failures')
const tooLarge=new Request('https://dispatch.invalid/mqtt/events',{method:'POST',headers:{authorization:`Bearer ${env.WEBHOOK_TOKEN}`},body:'x'.repeat(40001)})
assert.equal((await worker.default.fetch(tooLarge,env)).status,413,'streamed body bound applies without Content-Length')
const portable=core.sharedPortableClient
const sharedState=(sessionId,serverId,boot,seq=1)=>({topic:`aion2/query-workers/${portable}/${sessionId}/state`,username:`query-${portable}`,clientid:`query-${portable}-${sessionId}`,payload:{clientId:portable,sessionId,gameSessionId:'game',serverId,boot,seq,ready:true,cooldownMs:0}})
database.prepare('INSERT INTO device_fences VALUES(?,?,?,?)').run(portable,99,'legacy',100)
assert.equal((await send(sharedState('pc1','2201',30))).status,200)
assert.equal((await send(sharedState('pc2','2305',1))).status,200)
let sharedNodes=JSON.parse(database.prepare('SELECT payload FROM scheduler_state').get().payload).nodes
assert.equal(Object.values(sharedNodes).filter(n=>n.clientId===portable).length,2,'old device fence cannot reject different portable computers')
pool=new worker.QueryPool(ctx,env)
assert.equal((await (await send(sharedState('pc2','2201',1))).json()).ignored,true,'session duplicate is fenced across DO restart')
now+=90001;await pool.alarm()
assert.equal((await (await send(sharedState('pc2','2201',1))).json()).ignored,true,'pruned session cannot resurrect from an old heartbeat')
assert.equal((await send({...sharedState('pc3','2305',1),username:'browser'})).status,403)
database.close();console.log('PASS: Worker auth, broker identity, canonical D1 targets, durable outbox, restart, result routing, duplicate fencing, portable multi-computer sessions and idle alarms')
