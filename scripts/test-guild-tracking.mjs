import assert from 'node:assert/strict'
import { readFileSync,readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const db=new DatabaseSync(':memory:')
for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'))
db.exec("INSERT INTO game_characters(character_name,character_id,server_id,legion_name,first_seen_at,last_seen_at,updated_at) VALUES('one','1','1001','同名军团',1,1,1),('two','2','1002','同名军团',1,1,1)")
function load(path,deps={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Response,TextEncoder,require:name=>{assert.ok(name in deps,name);return deps[name]}});return exports}
const validation=load('src/lib/guild-tracking.ts')
let principal={userKey:'a',role:'agent'},scope=['1001']
const api=load('src/server/guild-tracking.server.ts',{
 'cloudflare:workers':{env:{DB:{prepare:sql=>({bind:(...args)=>({all:async()=>({results:db.prepare(sql).all(...args)}),first:async()=>db.prepare(sql).get(...args),run:async()=>({meta:db.prepare(sql).run(...args)})})})}}},
 './admin-auth.server':{currentAdminPrincipal:async()=>principal},'./server-access.server':{allowedServerIds:async()=>scope},
 './api-auth.server':{jsonError:(error,status)=>Response.json({ok:false,error},{status})},'#/lib/guild-tracking':validation,
})
const input={action:'claim',serverId:'1001',legionName:'同名军团',version:0}
const post=(body=input,origin='https://test')=>api.guildTrackingResponse(new Request('https://test/api/guild-tracking',{method:'POST',headers:{origin},body:JSON.stringify(body)}))
const get=()=>api.guildTrackingResponse(new Request('https://test/api/guild-tracking'))
assert.equal((await post()).status,200)
assert.equal((await post()).status,200)
assert.equal(db.prepare('SELECT COUNT(*) n FROM guild_tracking_events').get().n,1)
principal={userKey:'b',role:'agent'};assert.equal((await post()).status,409)
assert.equal((await post({...input,action:'release',version:1})).status,409)
assert.equal((await post({...input,serverId:'1002'})).status,403)
assert.equal((await post(input,'https://evil')).status,403)
for(const body of [{...input,legionName:''},{...input,version:-1},{...input,action:'force'},{...input,legionName:'x'.repeat(101)}])assert.equal((await post(body)).status,400)
let data=await(await get()).json();assert.equal(data.claims.length,1);assert.equal(data.claims[0].isMine,false);assert.equal(data.canManage,false);assert.equal('owner_user_key' in data.claims[0],false)
scope=[];assert.equal((await(await get()).json()).claims.length,0)
scope=['1001'];principal={userKey:'a',role:'agent'};assert.equal((await post({...input,action:'release',version:1})).status,200)
principal={userKey:'b',role:'agent'};assert.equal((await post()).status,200)
principal={userKey:'admin',role:'admin'};scope=null
assert.equal((await post({...input,action:'release',version:1})).status,409,'stale admin action cannot release a new owner')
assert.equal((await post({...input,action:'release',version:3})).status,200)
// Parallel contenders: exactly one owner, with unique ownership enforced at the storage layer.
const race=await Promise.all(['c','d'].map(userKey=>api.mutateGuild({userKey,role:'agent'},input)))
assert.equal(race.filter(Boolean).length,1)
assert.equal(await api.mutateGuild({userKey:'d',role:'agent'},{...input,serverId:'1002'}),true)
assert.equal((await api.listGuildClaims(principal,null)).length,2,'same name in another server is independent')
assert.equal(await api.mutateGuild(principal,{...input,legionName:'不存在'}),false)
assert.equal(db.prepare('SELECT COUNT(*) n FROM guild_tracking_events WHERE actor=?').get('admin').n,1)
// Empty/renamed guilds stay manageable through tracking list without a character FK.
db.exec("DELETE FROM game_characters WHERE server_id='1001'")
const orphan=(await api.listGuildClaims(principal,null)).find(c=>c.serverId==='1001')
assert.ok(orphan);assert.equal(await api.mutateGuild(principal,{...input,action:'release',version:orphan.version}),true)
principal=null;assert.equal((await get()).status,401);assert.equal((await post()).status,401)
db.close();console.log('PASS: exclusive claim, retry, concurrency, scope, origin, owner-only release, administrator CAS release, audit and orphan recovery')
