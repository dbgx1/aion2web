import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
const require=createRequire(import.meta.url)
const wranglerRequire=createRequire(new URL('../query-dispatch/package.json',import.meta.url))
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare')
const published=[]
const webhook='runtime-webhook-'.repeat(4),admin='runtime-admin-'.repeat(4)
const runtime=new Miniflare(convertV4MiniflareOptions({
  modules:true,scriptPath:'query-dispatch/artifacts/query-dispatch-dry-run/worker.js',compatibilityDate:'2026-09-30',
  durableObjects:{POOL:{className:'QueryPool',useSQLite:true}},d1Databases:{DB:'runtime-test'},
  bindings:{SERVICE_ID:'aion2web',DAILY_QUERY_LIMIT:'20000',WEBHOOK_TOKEN:webhook,ADMIN_TOKEN:admin,MQTT_PUBLISH_URL:'https://broker.test/publish',MQTT_API_KEY:'runtime-key',MQTT_API_SECRET:'runtime-secret'},
  outboundService:async request=>{assert.equal(new URL(request.url).hostname,'broker.test');published.push(await request.json());return Response.json({id:crypto.randomUUID()})},
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
  console.log('PASS: real workerd runtime, SQLite DO transaction, D1 canonical request, external publish, authenticated result routing')
}finally{await runtime.dispose()}
