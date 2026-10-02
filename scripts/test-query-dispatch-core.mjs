import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'
const exports = {}
runInNewContext(ts.transpileModule(readFileSync('query-dispatch/core.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, crypto: globalThis.crypto })
const { Scheduler, emptyState, defaults } = exports
let ids=0
const make = (limits=defaults,state=emptyState()) => new Scheduler(state,limits,()=>`id-${++ids}`)
const player = i => ({serverId:'1005',characterId:String(100+i)})
const req = (i, ps=[player(1)], userKey='u1') => ({requestId:`r${i}`,serviceId:'aion2web',userKey,expiresAt:180000,characters:ps})
const node = (s,id,now=0,seq=1,serverId='1005') => s.stateUpdate({clientId:id,sessionId:'boot1',gameSessionId:`game-${serverId}`,serverId,boot:1,seq,ready:true,cooldownMs:0},now)
const tasks = s => s.state.outbox.filter(d=>d.payload.type==='query_player_online')
const done = (s,t,now=100,status='online',type='completed') => { const [,,,client,session] = ('x/'+t.topic).split('/'); return s.event(client,session,{...t.payload,type,status},now) }
{
 const s=make(), clientId=exports.sharedPortableClient
 const report=(sessionId,serverId,boot,seq=1)=>s.stateUpdate({clientId,sessionId,gameSessionId:`g-${sessionId}`,serverId,boot,seq,ready:true,cooldownMs:0},0)
 report('pc1','2201',30);report('pc2','2305',1)
 s.submit(req(800,[{serverId:'2201',characterId:'801'},{serverId:'2305',characterId:'802'}]),0);s.tick(0)
 assert.equal(tasks(s).length,2,'shared credential must register different computers with independent boot counters')
 for(const t of tasks(s))assert.ok(t.topic.includes(t.payload.serverId==='2201'?'/pc1/':'/pc2/'))
 const first=tasks(s)[0],second=tasks(s)[1]
 done(s,first);assert.equal(Object.values(s.state.nodes).filter(n=>n.attemptId).length,1,'completion releases only its own session')
 done(s,second);assert.equal(Object.values(s.state.nodes).filter(n=>n.attemptId).length,0)
 report('pc2','2201',1,0);assert.equal(s.state.nodes[exports.nodeKey(clientId,'pc2')].serverId,'2305','out of order state cannot change server')
 const migrated=make(defaults,{...emptyState(),nodes:{[clientId]:{...s.state.nodes[exports.nodeKey(clientId,'pc1')],attemptId:'pending'}}})
 assert.equal(migrated.state.nodes[exports.nodeKey(clientId,'pc1')].attemptId,'pending','upgrade preserves existing reservation')
 const retry=make();for(const sessionId of ['one','two'])retry.stateUpdate({clientId,sessionId,gameSessionId:'game',serverId:'1005',boot:1,seq:1,ready:true,cooldownMs:0},0)
 retry.submit(req(801),0);retry.tick(0);const failed=tasks(retry)[0];done(retry,failed,1,'unknown','failed');retry.tick(1)
 assert.equal(tasks(retry).length,2);assert.notEqual(tasks(retry)[1].topic,failed.topic,'retry can use another computer under the same credential')
 console.log('PASS: portable multi-computer routing, independent ordering, reservations, migration and retry')
}
{
 const s=make();node(s,'a');node(s,'b');s.submit(req(1,[player(1),player(2),player(3)]),0);s.tick(0)
 assert.equal(tasks(s).length,2);assert.equal(new Set(tasks(s).map(t=>t.topic)).size,2)
 s.tick(1);assert.equal(tasks(s).length,2,'busy nodes cannot receive another task')
 const t=tasks(s)[0];assert.equal(done(s,t),true)
 s.tick(100);assert.equal(tasks(s).length,3,'completion immediately releases the node without a fixed delay')
 s.tick(101);assert.equal(tasks(s).length,3,'the replacement task remains serial')
 assert.equal(done(s,t,5101),false,'completed attempt cannot overwrite result')
}
{
 const s=make();node(s,'a');s.submit(req(1),0);s.submit(req(2,[player(1)],'u2'),0);s.tick(0)
 assert.equal(tasks(s).length,1,'same player coalesces across requesters')
 done(s,tasks(s)[0]);assert.equal(s.state.outbox.filter(d=>d.payload.type==='presence_result').length,2)
 s.submit(req(3,[player(1)],'u3'),101);assert.equal(Object.keys(s.state.jobs).length,0,'cached result avoids game request')
}
{
 const s=make();node(s,'a');node(s,'b');s.submit(req(1),0);s.tick(0);const old=tasks(s)[0]
 s.tick(25000);assert.equal(tasks(s).length,1,'expired task removed from outbox')
 const second=tasks(s)[0];assert.notEqual(second.topic,old.topic)
 assert.equal(done(s,old,25001),false,'late result fenced')
 s.tick(50000);assert.equal(Object.keys(s.state.jobs).length,0,'only one retry')
 assert.equal(s.state.requests.r1.results['1005:101'].status,'unknown','timeout is not offline')
}
{
 const s=make();node(s,'a');s.submit(req(1),0);s.tick(0)
 const restored=make(defaults,JSON.parse(JSON.stringify(s.state)));restored.tick(1)
 assert.equal(tasks(restored).length,1,'restart preserves reservation and outbox')
 done(restored,tasks(restored)[0],100,'offline');assert.equal(restored.state.requests.r1.results['1005:101'].status,'offline')
}
{
 const s=make();for(const id of ['a','b','c'])node(s,id)
 s.submit(req(1,[player(1),player(2)],'u1'),0);s.submit(req(2,[player(3),player(4)],'u2'),0);s.submit(req(3,[player(5)],'u3'),0);s.tick(0)
 assert.equal(tasks(s).map(t=>t.payload.characterId).join(','),'101,103,105','fair scheduling includes third user')
}
{
 const s=make({...defaults,dailyLimit:1});node(s,'a');node(s,'b');s.submit(req(1,[player(1),player(2)]),0);s.tick(0);assert.equal(tasks(s).length,1,'daily dispatch cap')
 assert.throws(()=>s.submit({...req(2),characters:[{serverId:'1005',characterId:'18446744073709551616'}]},1))
 assert.throws(()=>s.submit({...req(1),userKey:'someone-else'},1),'request hijack rejected')
 node(s,'a',2,0);assert.equal(s.state.nodes.a.seq,1,'old heartbeat ignored')
 s.tick(180000);assert.equal(Object.keys(s.state.requests.r1.results).length,2,'queued work expires explicitly')
}
{
 const s=make();node(s,'a')
 const boundary={serverId:'65535',characterId:'9223372036854775807'}
 node(s,'boundary',0,1,'65535');s.submit(req(90,[boundary]),0);s.tick(0)
 assert.equal(tasks(s)[0].payload.characterId,boundary.characterId,'native signed-63-bit maximum preserved exactly')
 for(const characterId of ['9223372036854775808','18446744073709551615','0','01','1e10','-1'])
   assert.throws(()=>s.submit(req(91,[{serverId:'1005',characterId}]),0),'targets unsupported by native game encoder must fail before dispatch')
}
console.log('PASS: idle distribution, cooldown, coalescing, cache, retries, fencing, restart, fairness, limits and expiry')
{
 const s=make();node(s,'server-1005',0,1,'1005');node(s,'server-2201',0,1,'2201')
 s.submit(req(70,[{serverId:'2201',characterId:'701'}]),0);s.tick(0)
 assert.match(tasks(s)[0].topic,/\/server-2201\//,'task is dispatched only to the exact same game server')
 assert.equal(tasks(s)[0].payload.serverId,'2201')
 const unmatched=make();node(unmatched,'other-server',0,1,'2201');unmatched.submit(req(71,[{serverId:'1005',characterId:'702'}]),0);unmatched.tick(0)
 assert.equal(tasks(unmatched).length,0,'different-server clients stay idle')
 assert.match(unmatched.state.requests.r71.results['1005:702'].error,/区服 1005 当前没有在线查询客户端/)
 assert.equal(Object.keys(unmatched.state.jobs).length,0,'unmatched targets finish immediately without waiting three minutes')
 assert.equal(unmatched.state.cache['1005:702'],undefined,'missing device is unknown, never cached as offline')
 assert.throws(()=>unmatched.stateUpdate({clientId:'bad',sessionId:'s',gameSessionId:'g',serverId:null,boot:1,seq:1,ready:true,cooldownMs:0},0),'ready client must identify its server')
 console.log('PASS: exact-server routing, immediate unmatched-server feedback and ready-state validation')
}
{
 const s=make();node(s,'a');s.submit(req(80,[player(1),player(2),{serverId:'2201',characterId:'9'}]),0);s.tick(0)
 assert.equal(tasks(s).length,1)
 assert.equal(s.state.requests.r80.results['2201:9'].status,'unknown')
 assert.equal(s.state.requests.r80.results['1005:102'],undefined,'busy same-server devices keep their jobs queued')
 done(s,tasks(s)[0],100);s.tick(100)
 assert.equal(tasks(s).length,2,'queued same-server target runs after the first finishes')
 const none=make();none.submit(req(81),0);none.tick(0)
 assert.match(none.state.requests.r81.results['1005:101'].error,/没有在线查询客户端/)
}
{
 for (const error of ['game_query_failed', 'game_query_failed:6437']) {
  const s=make();node(s,'a');s.submit(req(1,[player(1),player(2)]),0);s.tick(0)
  const task=tasks(s)[0]
  // Native client publishes ready before its terminal event; keep that state.
  node(s,'a',50,2,'1005')
  assert.equal(s.event('a','boot1',{...task.payload,type:'failed',status:'unknown',error},100),true)
  assert.equal(s.state.nodes.a.ready,true,'target rejection must not disable a healthy node')
  assert.equal(s.state.requests.r1.results['1005:101'].status,'unknown','single-node rejection returns immediately')
  assert.match(s.state.requests.r1.results['1005:101'].error,/游戏服务器拒绝/)
  assert.equal(s.state.cache['1005:101'],undefined,'rejection never becomes a cached presence result')
  s.tick(100);assert.equal(tasks(s).length,2,'other targets continue without waiting for heartbeat')
  done(s,tasks(s)[1],200,'online')
  assert.equal(s.state.requests.r1.results['1005:102'].status,'online','following target can still succeed')
 }
 const s=make();node(s,'a');node(s,'b');s.submit(req(1),0);s.tick(0)
 const first=tasks(s)[0]
 s.event('a','boot1',{...first.payload,type:'failed',status:'unknown',error:'game_query_failed:6437'},100)
 s.tick(100);assert.equal(tasks(s)[1].topic.includes('/b/'),true,'a second available client may resolve a region-specific rejection')
 done(s,tasks(s)[1],200,'offline');assert.equal(s.state.requests.r1.results['1005:101'].status,'offline')
 const broken=make();node(broken,'a');broken.submit(req(1),0);broken.tick(0)
 broken.event('a','boot1',{...tasks(broken)[0].payload,type:'failed',status:'unknown',error:'incomplete_response_prefix'},100)
 assert.equal(broken.state.nodes.a.ready,false,'malformed responses still require a new client state')
 console.log('PASS: game rejection, rolling client compatibility, ready-event order, alternate client and connection failures')
}
{
 const started=performance.now(),s=make()
 for(let i=0;i<1000;i++)node(s,`client-${String(i).padStart(4,'0')}`)
 for(let user=0;user<8;user++)s.submit(req(100+user,Array.from({length:50},(_,i)=>player(user*50+i)),`operator-${user}`),0)
 s.tick(0)
 const assigned=tasks(s)
 assert.equal(assigned.length,400,'all 400 independent targets receive an idle worker')
 assert.equal(new Set(assigned.map(t=>t.topic)).size,400,'one concurrent attempt per client')
 assert.equal(new Set(assigned.map(t=>t.payload.characterId)).size,400,'targets execute once')
 assert.equal(assigned.slice(0,8).map(t=>Math.floor((Number(t.payload.characterId)-100)/50)).join(','),'0,1,2,3,4,5,6,7','each operator gets a turn before the next cycle')
 for(const task of assigned)s.acknowledgeDelivery(task.id)
 for(const task of assigned)done(s,task,100,'online')
 assert.equal(Object.keys(s.state.jobs).length,0)
 assert.equal(s.state.outbox.length,400)
 const restored=make(defaults,JSON.parse(JSON.stringify(s.state)))
 restored.submit(req(200,Array.from({length:50},(_,i)=>player(i)),'cached-user'),200)
 restored.tick(200)
 assert.equal(tasks(restored).length,0,'new operator uses shared cache after restart')
 assert.equal(restored.state.dispatched,400,'cached lookups spend no additional game query budget')
 assert.ok(JSON.stringify(restored.state).length<1500000,'1000-client state fits adapter storage bound')
 console.log(`PASS: 1000 clients / 8 operators / 400 targets, unique dispatch, fair turns, restart cache (${Math.round(performance.now()-started)} ms)`)
}

{
 const s=make();s.stateUpdate({clientId:'cooldown',sessionId:'boot1',gameSessionId:'game1',serverId:'1005',boot:1,seq:1,ready:true,cooldownMs:5000},0);s.submit(req(90),0);s.tick(4999);assert.equal(tasks(s).length,0,'honor client reported cooldown');s.tick(5000);assert.equal(tasks(s).length,1)
}
