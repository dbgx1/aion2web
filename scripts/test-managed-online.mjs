import assert from 'node:assert/strict'
import { build } from 'esbuild'
const bundle = await build({entryPoints:['src/lib/managed-chat.ts'],bundle:true,write:false,format:'esm',platform:'node'})
const {ManagedChatRunner, managedKey} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const characters = Array.from({length:55},(_,i)=>({characterId:String(i),serverKey:'1001',name:'Role '+i}))
const config={agentId:'A1',room:'room',acquiredAt:1,scope:'online',intervalMs:15000,proactiveMs:180000}
let now=1000000, batches=[], sends=[], online=new Set(['0']), guard=null, queryOverride, runOverride
const runner=new ManagedChatRunner({now:()=>now,changed:()=>{},guard:()=>guard,verify:async()=>{},
 queryOnline:async(targets,signal)=>{batches.push(targets);if(queryOverride)return queryOverride(targets,signal);return targets.map(c=>({serverId:c.serverKey,characterId:c.characterId,status:online.has(c.characterId)?'online':'offline',checkedAt:now}))},
 run:async turn=>{if(runOverride)return runOverride(turn);await turn.send('hello')},
 send:async(c,role)=>{sends.push(role.characterId)},
})
await runner.start(config,async()=>characters)
assert.equal(runner.snapshot.total,55,'Online mode starts with the whole fixed filter, no manual status required')
now+=5000;await runner.tick();assert.equal(batches[0].length,50);assert.equal(sends.length,0)
await runner.tick();assert.deepEqual(sends,['0']);assert.equal(runner.snapshot.online,1)
online.add('54');now+=30000;await runner.tick();assert.deepEqual(batches[1].map(c=>c.characterId),['50','51','52','53','54'])
await runner.tick();assert.deepEqual(sends,['0','54'],'new online members are discovered beyond the first page')
const before=batches.length;now+=30000;await runner.tick();assert.equal(batches.length,before,'fresh cached results are reused')
online.clear();now+=180001;await runner.tick();await runner.tick();assert.equal(sends.length,2,'expired online must be rechecked and offline must not be sent')
online.add('0');now+=180001;await runner.tick();await runner.tick();assert.equal(sends.at(-1),'0','roles that come online again rejoin automatically')
const count=sends.length
runner.pause();now+=500000;await runner.tick();assert.equal(sends.length,count)
runner.resume();now+=5000;queryOverride=async()=>{throw new Error('429 busy')};await runner.tick();const attempts=batches.length
await runner.tick();assert.equal(batches.length,attempts,'failed query backs off instead of spinning')
assert.equal(runner.snapshot.status,'waiting')
queryOverride=undefined;now+=60000;await runner.tick()
runOverride=async turn=>{now+=180001;await assert.rejects(turn.send('stale'),/在线状态/)}
await runner.tick();assert.equal(sends.length,count,'online status must still be fresh immediately before publish')
runOverride=undefined
runner.stop();let resolveQuery
queryOverride=()=>new Promise(resolve=>{resolveQuery=resolve})
await runner.start(config,async()=>characters);now+=5000;const pending=runner.tick();await new Promise(resolve=>setImmediate(resolve))
runner.stop();resolveQuery([{serverId:'1001',characterId:'0',status:'online',checkedAt:now}]);await pending
assert.equal(runner.snapshot.status,'idle');assert.equal(runner.snapshot.online,undefined,'late query results cannot revive a stopped task')
queryOverride=undefined
await runner.start(config,async()=>characters);guard={permanent:true,message:'封禁'};now+=5000;await runner.tick()
assert.equal(runner.snapshot.status,'paused')
console.log('PASS: automatic discovery, batches, fresh cache, offline exclusion, rejoin, pre-send freshness, backoff, cancellation and ban')

// A status may expire (or turn offline) after selection but before publishing.
// This must not become a global AI failure, even when the SDK eats the error.
let raceNow=1000000, raceMode='expire', holdScan=false, failScan=false, finishScan, raceSends=[], raceRuns=[], scanCount=0
const raceRoles=characters.slice(0,2)
const raceResult=(role,status='online',checkedAt=raceNow)=>({serverId:role.serverKey,characterId:role.characterId,status,checkedAt})
const race=new ManagedChatRunner({now:()=>raceNow,changed:()=>{},guard:()=>null,verify:async()=>{},
 queryOnline:async roles=>{scanCount++;if(failScan)throw new Error('query unavailable');if(holdScan)return new Promise(resolve=>{finishScan=()=>resolve(roles.map(role=>raceResult(role)))});return roles.map(role=>raceResult(role))},
 run:async turn=>{
  raceRuns.push([turn.recipient.characterId,turn.reason])
  if(raceMode==='expire')raceNow+=2
  if(raceMode==='offline')race.recordPresence([turn.recipient],[raceResult(turn.recipient,'offline')])
  try { await turn.send('fixture-only') } catch {} // SDK tool exception consumption
 },
 send:async(_config,role)=>raceSends.push(role.characterId),
})
const raceStart=async(roles=raceRoles)=>{await race.start({...config,intervalMs:0},async()=>roles);raceNow+=5000;raceSends=[];raceRuns=[]}
await raceStart()
race.recordPresence(raceRoles,[raceResult(raceRoles[0],'online',raceNow-179999),raceResult(raceRoles[1])])
await race.tick()
assert.equal(race.snapshot.retryAt,0,'Presence expiry does not impose the 60-second provider backoff')
assert.equal(race.snapshot.status,'running');assert.equal(race.snapshot.turns,0);assert.equal(raceSends.length,0)
holdScan=true;raceMode='send'
const raceScan=race.tick();await new Promise(resolve=>setImmediate(resolve))
await race.tick()
assert.deepEqual(raceSends,['1'],'Other fresh roles can send while the expired role is being rechecked')
finishScan();await raceScan;holdScan=false
await race.tick()
assert.deepEqual(raceSends,['1','0'],'Expired role rejoins after confirmed fresh online status')
assert.deepEqual(raceRuns.at(-1),['0','proactive'],'Deferral does not fabricate a received private message')

await raceStart();raceMode='offline'
race.recordPresence(raceRoles,raceRoles.map(role=>raceResult(role)))
await race.tick();raceMode='send';const scansBeforeOffline=scanCount
await race.tick()
assert.deepEqual(raceSends,['1'],'Fresh offline update blocks only the affected role')
assert.equal(race.snapshot.retryAt,0)
assert.equal(scanCount,scansBeforeOffline,'A confirmed offline role is not immediately queried again')

// Local deferral must not bypass an actual presence-service failure backoff.
await raceStart(characters.slice(0,3));raceMode='expire';failScan=true
race.recordPresence(raceRoles,[raceResult(raceRoles[0],'online',raceNow-179999),raceResult(raceRoles[1])])
await race.tick();const failedScans=scanCount // query for the third, unknown role fails
await race.tick();raceMode='send';await race.tick()
assert.equal(scanCount,failedScans,'Existing query backoff is retained after one role expires')
assert.deepEqual(raceSends,['1'])
race.stop()
console.log('PASS: in-flight expiry/offline defers only the affected role; swallowed errors preserved; other roles continue; recheck/rejoin; proactive identity; real query backoff retained')
