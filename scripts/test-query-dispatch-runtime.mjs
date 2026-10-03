import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
const require=createRequire(import.meta.url)
const wranglerRequire=createRequire(new URL('../query-dispatch/package.json',import.meta.url))
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare')
const published=[]
let heldTopic='',releaseResult,enteredResult
const webhook='runtime-webhook-'.repeat(4),admin='runtime-admin-'.repeat(4)
const runtime=new Miniflare(convertV4MiniflareOptions({
  modules:true,scriptPath:'query-dispatch/artifacts/query-dispatch-dry-run/worker.js',compatibilityDate:'2026-09-30',
  durableObjects:{POOL:{className:'QueryPool',useSQLite:true}},d1Databases:{DB:'runtime-test'},
  bindings:{SERVICE_ID:'aion2web',DAILY_QUERY_LIMIT:'20000',WEBHOOK_TOKEN:webhook,ADMIN_TOKEN:admin,MQTT_PUBLISH_URL:'https://broker.test/publish',MQTT_API_KEY:'runtime-key',MQTT_API_SECRET:'runtime-secret'},
  outboundService:async request=>{assert.equal(new URL(request.url).hostname,'broker.test');const body=await request.json();published.push(body);if(body.topic===heldTopic){enteredResult();await new Promise(resolve=>{releaseResult=resolve})}return Response.json({id:crypto.randomUUID()})},
}))
try{
  const db=await runtime.getD1Database('DB')
  for(const migration of ['0008_presence_queue.sql','0009_presence_service_requests.sql','0022_presence_verified_results.sql'])
    await db.exec(readFileSync('migrations/'+migration,'utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' '))
  await db.prepare('INSERT INTO presence_requests(id,user_key,service_id,characters_json,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind('request-real-runtime','u1','aion2web',JSON.stringify([{serverId:'1005',characterId:'123',name:'Runtime fixture'}]),Date.now(),Date.now()+180000).run()
  const send=body=>runtime.dispatchFetch('http://localhost/mqtt/events',{method:'POST',headers:{authorization:`Bearer ${webhook}`},body:JSON.stringify(body)})
  assert.equal((await runtime.dispatchFetch('http://localhost/status')).status,401)
  const node={clientId:'runtime',sessionId:'one',gameSessionId:'game1',serverId:'1005',boot:1,seq:1,ready:true,cooldownMs:0}
  assert.equal((await send({topic:'aion2/query-workers/runtime/one/state',clientid:'query-runtime-one',username:'query-runtime',payload:node})).status,200)
  assert.equal((await send({topic:'aion2/presence/aion2web/requests',clientid:'browser',username:'browser',payload:{requestId:'request-real-runtime'}})).status,200)
  const firstTask=published.find(p=>p.topic.endsWith('/task'))
  assert.ok(firstTask,JSON.stringify(await (await runtime.dispatchFetch('http://localhost/status',{headers:{authorization:`Bearer ${admin}`}})).json()))
  const task=JSON.parse(firstTask.payload)
  assert.equal(task.characterId,'123')
  assert.equal((await send({topic:'aion2/query-workers/runtime/one/events',clientid:'query-runtime-one',username:'query-runtime',payload:{type:'completed',taskId:task.taskId,attemptId:task.attemptId,gameSessionId:'game1',status:'offline'}})).status,200)
  const result=published.find(p=>p.topic.endsWith('/results/request-real-runtime'))
  assert.equal(JSON.parse(result.payload).results[0].status,'offline')
  const proof=await db.prepare('SELECT status,checked_at FROM presence_verified_results WHERE request_id=?').bind('request-real-runtime').first()
  assert.equal(proof.status,'offline');assert.equal(proof.checked_at,JSON.parse(result.payload).results[0].checkedAt)
  const stored=await db.prepare('SELECT * FROM character_presence WHERE server_id=? AND character_id=?').bind('1005','123').first()
  assert.equal(stored.is_online,0,'result persists without a browser POST')
  assert.equal(stored.character_name,'Runtime fixture','name comes from the authorized canonical request')
  assert.equal((await db.prepare('SELECT finished FROM presence_requests WHERE id=?').bind('request-real-runtime').first()).finished,1)
  const status=await (await runtime.dispatchFetch('http://localhost/status',{headers:{authorization:`Bearer ${admin}`}})).json()
  assert.equal(status.queued,0);assert.equal(status.deliveries,0);assert.equal(status.dispatchedToday,1)
  await db.prepare('INSERT INTO presence_requests(id,user_key,service_id,characters_json,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind('slow-result','u1','aion2web',JSON.stringify([{serverId:'1005',characterId:'300'},{serverId:'1005',characterId:'301'}]),Date.now(),Date.now()+180000).run()
  await send({topic:'aion2/presence/aion2web/requests',clientid:'browser',username:'browser',payload:{requestId:'slow-result'}})
  const slowTask=JSON.parse(published.filter(p=>p.topic.endsWith('/task')).at(-1).payload)
  const state=seq=>({topic:'aion2/query-workers/runtime/one/state',clientid:'query-runtime-one',username:'query-runtime',payload:{...node,seq,ready:seq!==2}})
  await send(state(2))
  heldTopic='aion2/presence/aion2web/results/slow-result'
  const entered=new Promise(resolve=>{enteredResult=resolve})
  const complete=task=>send({topic:'aion2/query-workers/runtime/one/events',clientid:'query-runtime-one',username:'query-runtime',payload:{type:'completed',taskId:task.taskId,attemptId:task.attemptId,gameSessionId:'game1',status:'online'}})
  const completing=complete(slowTask)
  let watchdog
  try {
    await Promise.race([entered,new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(new Error('result publication not reached')),5000)})]);clearTimeout(watchdog)
    const ready=await Promise.race([send(state(3)),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(new Error('ready webhook blocked behind slow result publication')),5000)})]);clearTimeout(watchdog)
    assert.equal(ready.status,200)
    const nextTask=JSON.parse(published.filter(p=>p.topic.endsWith('/task')).at(-1).payload)
    assert.equal(nextTask.characterId,'301','next game task arrives before prior result HTTP response completes')
    assert.equal(published.filter(p=>p.topic===heldTopic).length,1,'concurrent webhook does not duplicate in-flight result delivery')
    heldTopic='';releaseResult();await completing
    assert.equal((await complete(nextTask)).status,200)
    const after=await (await runtime.dispatchFetch('http://localhost/status',{headers:{authorization:`Bearer ${admin}`}})).json()
    assert.equal(after.queued,0);assert.equal(after.deliveries,0,'old delivery snapshot cannot overwrite concurrent dispatch or acknowledgements')
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM presence_verified_results WHERE request_id='slow-result'").first()).n,2)
  } finally {clearTimeout(watchdog);heldTopic='';releaseResult?.()}
  console.log('PASS: slow prior result publication does not block readiness or next task; no duplicate sends or stale-state overwrite')
  const submit=id=>send({topic:'aion2/presence/aion2web/requests',clientid:'browser',username:'browser',payload:{requestId:id}})
  for(const [i,id] of ['cancel-batch','cancel-current','replacement'].entries()){
    await db.prepare('INSERT INTO presence_requests(id,user_key,service_id,characters_json,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id,'u1','aion2web',JSON.stringify([{serverId:'1005',characterId:String(500+i)}]),Date.now(),Date.now()+180000).run()
  }
  assert.equal((await submit('cancel-batch')).status,200)
  const pendingTask=JSON.parse(published.filter(p=>p.topic.endsWith('/task')).at(-1).payload)
  assert.equal((await submit('cancel-current')).status,200)
  await db.prepare("UPDATE presence_requests SET finished=1 WHERE id IN ('cancel-batch','cancel-current')").run()
  assert.equal((await submit('replacement')).status,200,'two stopped requests cannot exhaust per-user admission')
  assert.equal((await submit('cancel-batch')).status,410,'delayed MQTT publication cannot resurrect stopped request')
  const taskCount=published.filter(p=>p.topic.endsWith('/task')).length
  assert.equal((await send({topic:'aion2/query-workers/runtime/one/events',clientid:'query-runtime-one',username:'query-runtime',payload:{type:'completed',taskId:pendingTask.taskId,attemptId:pendingTask.attemptId,gameSessionId:'game1',status:'online'}})).status,200)
  assert.equal(published.filter(p=>p.topic.endsWith('/task')).length,taskCount+1)
  assert.equal(JSON.parse(published.filter(p=>p.topic.endsWith('/task')).at(-1).payload).characterId,'502')
  assert.equal(published.some(p=>p.topic.endsWith('/results/cancel-batch')),false,'late completion does not publish cancelled result')
  assert.equal((await submit('request-real-runtime')).status,200,'completed request can replay committed results after reconnect')
  console.log('PASS: D1 cancellation releases both occupied slots before admission; old in-flight response remains fenced; completed result replay works')
  const batchNode={clientId:'batch-runtime',sessionId:'one',gameSessionId:'game2',serverId:'2201',boot:1,seq:1,ready:true,cooldownMs:0,batchSize:50}
  const batchHook=(kind,payload)=>send({topic:`aion2/query-workers/batch-runtime/one/${kind}`,clientid:'query-batch-runtime-one',username:'query-batch-runtime',payload})
  assert.equal((await batchHook('state',batchNode)).status,200)
  const players=Array.from({length:50},(_,i)=>({serverId:'2201',characterId:String(1000+i)}))
  await db.prepare('INSERT INTO presence_requests(id,user_key,service_id,characters_json,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind('batch-fifty','batch-user','aion2web',JSON.stringify(players),Date.now(),Date.now()+180000).run()
  assert.equal((await submit('batch-fifty')).status,200)
  const batchTask=published.map(p=>JSON.parse(p.payload)).find(p=>p.type==='query_players_online')
  assert.equal(batchTask.tasks.length,50);assert.ok(batchTask.expiresAt<=Date.now()+100000)
  assert.equal(published.some(p=>p.topic.endsWith('/results/batch-fifty')),false)
  const report={type:'batch_completed',batchId:batchTask.batchId,gameSessionId:'game2',results:batchTask.tasks.map((t,i)=>({type:i===49?'failed':'completed',taskId:t.taskId,attemptId:t.attemptId,gameSessionId:'game2',status:i===49?'unknown':i%2?'offline':'online',checkedAt:Date.now(),...(i===49?{error:'game_query_failed:12'}:{})}))}
  assert.equal((await batchHook('events',report)).status,200)
  const replies=published.filter(p=>p.topic.endsWith('/results/batch-fifty'))
  assert.equal(replies.length,1);assert.equal(JSON.parse(replies[0].payload).results.length,50)
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM presence_verified_results WHERE request_id='batch-fifty'").first()).n,50)
  assert.equal((await db.prepare("SELECT finished FROM presence_requests WHERE id='batch-fifty'").first()).finished,1)
  assert.ok(published.some(p=>JSON.parse(p.payload).type==='query_result_ack'))
  assert.equal((await batchHook('events',report)).status,200)
  assert.equal(published.filter(p=>p.topic.endsWith('/results/batch-fifty')).length,1)
  console.log('PASS: real runtime 50-player task, atomic D1 result batch, one MQTT reply, application acknowledgement and duplicate report')
  console.log('PASS: real workerd runtime, SQLite DO transaction, D1 canonical request, external publish, authenticated result routing')
}finally{await runtime.dispose()}
