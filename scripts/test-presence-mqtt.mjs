import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as zod from 'zod'

function load(path, dependencies = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  runInNewContext(outputText, { exports, Response, crypto, TextDecoder, setTimeout, clearTimeout, ...globals,
    require: name => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  })
  return exports
}
const protocol = load('../src/lib/presence-mqtt.ts', { zod })
const characters = [{ serverId: '1001', characterId: '123', name: 'One' }, { serverId: '1002', characterId: '123', name: 'Two' }]
function query(charactersToQuery = characters) {
  const requestId = crypto.randomUUID()
  return { type:'presence_query', requestId, serviceId:'test-service',
    requestTopic:'aion2/presence/test-service/requests',
    replyTopic:`aion2/presence/test-service/results/${requestId}`,
    expiresAt:Date.now()+180000, characters:charactersToQuery }
}
class Client extends EventEmitter {
  connected = true
  commands = []
  subscribe(topic, options, callback) { callback(null, [{topic, qos:1}]) }
  unsubscribe() {}
  publish(topic, json, options, callback) {
    this.commands.push({topic, ...JSON.parse(json)})
    assert.equal(options.qos,1)
    assert.equal(options.retain,false)
    callback()
  }
  reply(query, results, overrides = {}, topic = query.replyTopic) {
    this.emit('message', topic, Buffer.from(JSON.stringify({type:'presence_result',requestId:query.requestId,results,...overrides})))
  }
}
test('two simultaneous operators share a service without sharing requests or results', async () => {
  const client = new Client()
  const a = query(), b = query()
  const receivedA = [], receivedB = []
  const first = protocol.queryPresenceMqtt(client,a,value=>receivedA.push(value),new AbortController().signal)
  const second = protocol.queryPresenceMqtt(client,b,value=>receivedB.push(value),new AbortController().signal)
  assert.equal(client.commands[0].topic,client.commands[1].topic)
  assert.notEqual(client.commands[0].replyTopic,client.commands[1].replyTopic)
  assert.equal(client.commands[0].target,undefined)
  const result = {...characters[0],status:'online',checkedAt:Date.now()}
  client.reply(a,[result],{requestId:b.requestId})
  client.reply(a,[{...result,characterId:'unrequested'}])
  client.reply(a,[{...result,status:'bad'}])
  assert.equal(receivedA.length,0)
  client.reply(a,[result])
  client.reply(a,[result])
  assert.equal(receivedA.length,1)
  assert.equal(receivedB.length,0)
  client.reply(a,[{...characters[1],status:'offline',checkedAt:Date.now()}])
  await first
  client.reply(b,characters.map(character=>({...character,status:'unknown',checkedAt:Date.now(),error:'Unavailable'})))
  await second
  assert.equal(receivedB.length,1)
  assert.equal(client.listenerCount('message'),0)
})
test('slow replies and disconnects warn the operator and timeout remains bounded', async () => {
  const timers = [], cleared = [], progress = []
  const timed = load('../src/lib/presence-mqtt.ts', {zod}, {
    setTimeout(callback, ms) { timers.push({callback, ms}); return timers.length },
    clearTimeout(id) { cleared.push(id) },
  })
  const client = new Client(), request = query(), received = []
  const done = timed.queryPresenceMqtt(client, request, value => received.push(value), new AbortController().signal,
    (message, warning) => progress.push({message, warning}))
  timers.find(timer => timer.ms === 15000).callback()
  assert.equal(progress.at(-1).warning, true)
  assert.match(progress.at(-1).message, /查询较慢.*2 个角色.*最多再等待/)
  client.emit('close')
  assert.equal(progress.at(-1).warning, true)
  assert.match(progress.at(-1).message, /连接已中断.*检查网络/)
  const rejected = assert.rejects(done, /超时.*检查对应区服/)
  timers.find(timer => timer.ms > 15000).callback()
  await rejected
  assert.equal(received[0].results.length, 2)
  assert.ok(cleared.includes(1) && cleared.includes(2), 'Both warning and expiry timers are released')
})
test('timeout only marks missing roles unknown and cancellation before SUBACK sends nothing', async () => {
  let expire, delay
  const timed = load('../src/lib/presence-mqtt.ts',{zod},{setTimeout:(callback, ms)=>{expire=callback;delay=ms;return 1},clearTimeout(){}})
  const client = new Client(), received = [], request = query()
  const done = timed.queryPresenceMqtt(client,request,value=>received.push(value),new AbortController().signal)
  assert.equal(timed.PRESENCE_TIMEOUT_MS,180000)
  assert.ok(delay > 179000 && delay <= 180000, 'client must wait the full 180-second query window')
  const rejected = assert.rejects(done,/超时/)
  client.reply(request,[{...characters[0],status:'online',checkedAt:Date.now()}])
  expire()
  await rejected
  assert.equal(received[1].results.length,1)
  assert.equal(received[1].results[0].serverId,'1002')
  assert.equal(received[1].results[0].status,'unknown')
  const controller = new AbortController()
  let subscribed
  client.subscribe = (topic, options, callback) => { subscribed = () => callback(null,[{topic,qos:1}]) }
  const canceled = timed.queryPresenceMqtt(client,query(),()=>assert.fail(),controller.signal)
  const aborted = assert.rejects(canceled,/停止/)
  const sent = client.commands.length
  controller.abort()
  subscribed()
  await aborted
  assert.equal(client.commands.length,sent)
})

test('reconnect resubscribes and queries only missing roles, ignoring old SUBACKs', async () => {
  const client = new Client(), request = query(), received = [], progress = []
  const done = protocol.queryPresenceMqtt(client, request, value => received.push(value), new AbortController().signal, message => progress.push(message))
  client.reply(request, [{...characters[0], status:'online', checkedAt:Date.now()}])
  client.connected = false
  client.emit('close')
  assert.equal(received.length, 1, 'disconnect must not mark pending roles unknown')
  const callbacks = []
  client.subscribe = (topic, options, callback) => callbacks.push(() => callback(null, [{topic, qos:1}]))
  client.connected = true
  client.emit('connect')
  client.connected = false
  client.emit('close')
  client.connected = true
  client.emit('connect')
  callbacks[0]()
  assert.equal(client.commands.length, 1, 'old connection callback must not publish')
  callbacks[1]()
  assert.deepEqual(client.commands[1].characters, [characters[1]])
  assert.equal(client.commands[1].expiresAt, request.expiresAt)
  client.reply(request, characters.map(character => ({...character,status:'online',checkedAt:Date.now()})))
  await done
  assert.equal(received[1].results.length, 1)
  assert.ok(progress.some(message => message.includes('等待重连')))
  for (const event of ['connect','close','end','message']) assert.equal(client.listenerCount(event), 0)
})

test('waiting for connection stays bounded and can be canceled or explicitly ended', async () => {
  let expire
  const timed = load('../src/lib/presence-mqtt.ts', {zod}, {setTimeout: callback => {expire = callback; return 1}, clearTimeout(){}})
  const client = new Client()
  client.connected = false
  const received = []
  const done = timed.queryPresenceMqtt(client, query(), value => received.push(value), new AbortController().signal)
  const rejected = assert.rejects(done, /超时/)
  expire()
  await rejected
  assert.equal(received[0].results.length, 2)
  assert.equal(client.commands.length, 0)
  const controller = new AbortController()
  const canceled = timed.queryPresenceMqtt(client, query(), () => assert.fail(), controller.signal)
  const cancellation = assert.rejects(canceled, /停止/)
  controller.abort()
  await cancellation
  client.connected = true
  client.emit('connect')
  assert.equal(client.commands.length, 0)
  const ended = timed.queryPresenceMqtt(client, query(), () => {}, new AbortController().signal)
  const ending = assert.rejects(ended, /已断开/)
  client.emit('end')
  await ending
  for (const event of ['connect','close','end','message']) assert.equal(client.listenerCount(event), 0)
})

test('request ownership, role validation, idempotency, cache ordering and global capacity use actual SQL', async () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const migration of ['0008_presence_queue.sql','0009_presence_service_requests.sql','0022_presence_verified_results.sql','0023_presence_request_retention.sql']) db.exec(readFileSync(new URL('../migrations/'+migration,import.meta.url),'utf8'))
  const D1 = {
    prepare(sql) {
      const execute = args => ({
        run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}}),
        first:async()=>db.prepare(sql).get(...args),
        all:async()=>({results:db.prepare(sql).all(...args)}),
      })
      return {...execute([]),bind:(...args)=>{
        assert.ok(args.length <= 100, `D1 binding limit exceeded: ${args.length}`)
        return execute(args)
      }}
    },
    async batch(statements) {
      db.exec('BEGIN')
      try { const results=[]; for(const statement of statements) results.push(await statement.run()); db.exec('COMMIT');return results }
      catch(error) { db.exec('ROLLBACK');throw error }
    },
  }
  try {
    const service = load('../src/server/presence.server.ts',{
      'cloudflare:workers':{env:{DB:D1,PRESENCE_SERVICE_ID:'partner'}},'#/lib/presence-mqtt':protocol,
    })
    const alice = {userKey:'alice'}, bob = {userKey:'bob'}
    const common = {
      '#/server/server-access.server':{canAccessServers:async principal=>principal.userKey!=='denied'},
      '@tanstack/react-router':{createFileRoute:()=>options=>options},
      '#/server/admin-auth.server':{currentAdminPrincipal:async request=>request.headers.get('cookie')==='alice'?alice:request.headers.get('cookie')==='bob'?bob:null},
      '#/server/api-auth.server':{jsonError:(error,status)=>Response.json({error},{status})},
      '#/server/presence.server':service,'#/lib/presence-mqtt':protocol,zod,
    }
    const resultsRoute = load('../src/routes/api/presence/results.ts',common).Route
    const requestsRoute = load('../src/routes/api/presence/requests.ts',common).Route
    const send = (route, method, body, user='alice') => route.server.handlers[method]({request:new Request('http://localhost/api/presence/test',{
      method,headers:{'Content-Type':'application/json',Cookie:user},body:JSON.stringify(body),
    })})
    assert.equal((await send(requestsRoute,'POST',{characters},'')).status,401)
    assert.equal((await send(requestsRoute,'POST',{characters:[null]})).status,400)
    const oldExpiry=Date.now()-8*86400000
    for(let index=0;index<101;index++){
      db.prepare('INSERT INTO presence_requests VALUES(?,?,?,?,?,?,?)').run('old-'+index,'old','partner','[]',oldExpiry-1000,oldExpiry,1)
      db.prepare('INSERT INTO presence_verified_results VALUES(?,?,?,?,?)').run('old-'+index,'1005','123','online',oldExpiry)
      db.prepare('INSERT INTO presence_request_results VALUES(?,?,?)').run('old-'+index,'1005','123')
    }
    const a = (await (await send(requestsRoute,'POST',{characters})).json()).query
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM presence_requests WHERE id LIKE 'old-%'").get().n,1,'cleanup batch is bounded to 100 requests')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM presence_verified_results').get().n,1,'proofs cascade with expired requests')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM presence_request_results').get().n,1,'receipts cascade with expired requests')
    const b = (await (await send(requestsRoute,'POST',{characters},'bob')).json()).query
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM presence_requests WHERE id LIKE 'old-%'").get().n,0,'subsequent request drains remaining old history')
    assert.ok(protocol.presenceQuerySchema.safeParse(a).success)
    assert.equal(a.serviceId,'partner')
    assert.equal(a.expiresAt-db.prepare('SELECT created_at FROM presence_requests WHERE id=?').get(a.requestId).created_at,180000)
    assert.notEqual(a.replyTopic,b.replyTopic)
    const now=Date.now()
    const payload={type:'presence_result',requestId:a.requestId,results:[{...characters[0],status:'online',checkedAt:now}]}
    const confirm=envelope=>{for(const r of envelope.results)db.prepare('INSERT OR IGNORE INTO presence_verified_results VALUES(?,?,?,?,?)').run(envelope.requestId,r.serverId,r.characterId,r.status,r.checkedAt)}
    assert.equal((await send(resultsRoute,'POST',payload,'')).status,401)
    assert.equal((await send(resultsRoute,'POST',payload,'bob')).status,403)
    assert.equal((await send(resultsRoute,'POST',{...payload,results:[{...payload.results[0],characterId:'other'}]})).status,400)
    assert.equal((await send(resultsRoute,'POST',{...payload,results:[{...payload.results[0],checkedAt:now-120000}]})).status,400)
    assert.equal((await send(resultsRoute,'POST',payload)).status,409,'browser claims need dispatcher evidence')
    assert.equal((await (await send(resultsRoute,'POST',{...payload,results:[{...payload.results[0],status:'unknown'}]})).json()).saved,0,'local timeout must not change stored observations')
    confirm(payload)
    assert.equal((await (await send(resultsRoute,'POST',payload)).json()).saved,1)
    assert.equal((await send(resultsRoute,'POST',{...payload,results:[{...payload.results[0],status:'offline',checkedAt:now+1}]})).status,409,'browser cannot replace confirmed online with forged offline')
    const older={...payload,requestId:b.requestId,results:[{...payload.results[0],status:'offline',checkedAt:now-1}]}
    confirm(older)
    assert.equal((await (await send(resultsRoute,'POST',older,'bob')).json()).saved,0)
    assert.equal((await service.listPresenceStatus(characters))[0].status,'online')
    const timeout={...payload,results:[{...characters[1],status:'unknown',checkedAt:now,error:'Timeout'}]};confirm(timeout)
    await send(resultsRoute,'POST',timeout)
    assert.equal((await service.listPresenceStatus(characters))[1].online,null)
    const many = Array.from({length:500},(_,index)=>({serverId:'1001',characterId:String(index)}))
    many[0] = characters[0]
    const manyStatuses = await service.listPresenceStatus(many)
    assert.equal(manyStatuses.length,500,'500 lookups must work within D1 per-statement limits')
    assert.equal(manyStatuses[0].status,'online')
    assert.equal(manyStatuses[499].characterId,'499')
    assert.equal((await service.listPresenceStatus(Array(500).fill(characters[0]))).length,500,'Duplicate inputs retain their output order')
    assert.equal(db.prepare('SELECT finished FROM presence_requests WHERE id=?').get(a.requestId).finished,1)
    await send(requestsRoute,'DELETE',{requestId:b.requestId})
    assert.equal(db.prepare('SELECT finished FROM presence_requests WHERE id=?').get(b.requestId).finished,0,'Alice cannot finish Bob request')
    await send(requestsRoute,'DELETE',{requestId:b.requestId},'bob')
    assert.equal(db.prepare('SELECT finished FROM presence_requests WHERE id=?').get(b.requestId).finished,1)
    const newer=await service.createPresenceRequest(characters,alice)
    const newerResult={...payload,requestId:newer.requestId,results:[{...payload.results[0],status:'offline',checkedAt:now+2}]};confirm(newerResult)
    await service.storeMqttPresenceResults(newerResult,alice)
    assert.equal((await service.listPresenceStatus(characters))[0].status,'offline')
    const unknownRequest=await service.createPresenceRequest([characters[0]],alice)
    const unknownResult={...payload,requestId:unknownRequest.requestId,results:[{...payload.results[0],status:'unknown',checkedAt:now+3}]};confirm(unknownResult)
    await service.storeMqttPresenceResults(unknownResult,alice)
    assert.equal((await service.listPresenceStatus(characters))[0].status,'offline','unknown cannot erase a confirmed observation')
    db.prepare('UPDATE character_presence SET checked_at=? WHERE server_id=? AND character_id=?').run(Date.now()-600000,characters[0].serverId,characters[0].characterId)
    assert.equal((await service.listPresenceStatus(characters))[0].status,'stale','Old offline status must not claim the role is still offline')
    db.prepare('UPDATE character_presence SET is_online=1, checked_at=? WHERE server_id=? AND character_id=?').run(Date.now()-120000,characters[0].serverId,characters[0].characterId)
    assert.equal((await service.listPresenceStatus(characters))[0].status,'online','Online remains green at two minutes')
    db.prepare('UPDATE character_presence SET checked_at=? WHERE server_id=? AND character_id=?').run(Date.now()-180001,characters[0].serverId,characters[0].characterId)
    assert.equal((await service.listPresenceStatus(characters))[0].status,'stale','Online becomes yellow after three minutes')
    await service.finishPresenceRequest(newer.requestId,alice)
    const active=await service.createPresenceRequest(characters,alice)
    await service.createPresenceRequest(characters,alice)
    await assert.rejects(service.createPresenceRequest(characters,alice),error=>error.status===429)
    for(let index=0;index<6;index++) await service.createPresenceRequest(characters,{userKey:'operator-'+index})
    await assert.rejects(service.createPresenceRequest(characters,{userKey:'extra'}),error=>error.status===429)
    await service.finishPresenceRequest(active.requestId,alice)
    await service.createPresenceRequest(characters,{userKey:'extra'})
  } finally { db.close() }
})


test('queries canceled or expired offline release topics and listeners across repeated reconnects', async () => {
  let expire
  const timed = load('../src/lib/presence-mqtt.ts',{zod},{setTimeout:fn=>{expire=fn;return 1},clearTimeout(){}})
  const client=new Client(), subscribed=new Set()
  client.subscribe=(topic,options,callback)=>{subscribed.add(topic);callback(null,[{topic,qos:1}])}
  client.unsubscribe=topic=>{subscribed.delete(topic)}
  for(let i=0;i<200;i++){
    client.connected=true
    const controller=new AbortController(), q=query()
    const result=timed.queryPresenceMqtt(client,q,()=>{},controller.signal)
    const rejected=assert.rejects(result,i%2?/超时/:/停止/)
    client.connected=false;client.emit('close')
    if(i%2)expire();else controller.abort()
    await rejected
    assert.equal(subscribed.size,0,'no finished topic is retained for resubscription')
    for(const event of ['message','connect','close','end'])assert.equal(client.listenerCount(event),0)
    const before=client.commands.length;client.connected=true;client.emit('connect')
    assert.equal(client.commands.length,before,'completed query must not restart on reconnect')
  }
})
