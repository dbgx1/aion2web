import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const db = new DatabaseSync(':memory:')
for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${file}`, 'utf8'))
const insert=db.prepare('INSERT INTO game_characters(character_name,character_id,server_id,legion_name,level,combat_power,first_seen_at,last_seen_at,updated_at) VALUES(?,?,?,?,50,?,1,1,1)')
insert.run('甲','a','1001','同名军团',100)
insert.run('乙','b','1001','同名军团',100)
insert.run('未知','c','1001','同名军团',null)
insert.run('丙','d','1002','同名军团',200)
for(let i=0;i<55;i++)insert.run('角色'+i,'x'+i,'1001','小军团',i)
insert.run('无军团','no','1001','',1)
let scope=['1001'], principal={userKey:'a'}
const exports={}
const deps={
 'cloudflare:workers':{env:{DB:{prepare:sql=>({bind:(...args)=>({all:async()=>({results:db.prepare(sql).all(...args)}),first:async()=>db.prepare(sql).get(...args)})})}}},
 './admin-auth.server':{currentAdminPrincipal:async()=>principal},
 './server-access.server':{allowedServerIds:async()=>scope},
 './api-auth.server':{jsonError:(error,status)=>Response.json({ok:false,error},{status})},
}
runInNewContext(ts.transpileModule(readFileSync('src/server/intelligence.server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Response,require:name=>deps[name]})
const request=q=>exports.intelligenceResponse(new Request('https://test/api/intelligence?'+q))
const get=async q=>{const r=await request(q);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');return r.json()}
let data=await get('view=players&metric=power');assert.equal(data.total,58);assert.equal(data.rows.length,50);assert.equal(data.rows[0].rank,1);assert.equal(data.rows[1].rank,1);assert.equal(data.rows[2].rank,3);assert.ok(data.rows.every(r=>r.server_id==='1001'))
const next=await get('view=players&metric=power&page=1');assert.equal(next.rows.length,8);assert.equal(new Set([...data.rows,...next.rows].map(r=>r.id)).size,58)
data=await get('view=players&metric=power&q='+encodeURIComponent('角色54'));assert.equal(data.rows[0].rank,3)
data=await get('view=guilds&metric=average&q='+encodeURIComponent('同名'));assert.equal(data.rows[0].score,100);assert.equal(data.rows[0].member_count,3);assert.equal(data.rows[0].known_power_count,2)
scope=null;data=await get('view=guilds&metric=members&q='+encodeURIComponent('同名'));assert.equal(data.rows.length,2)
data=await get('view=players&metric=power&server=1001&q='+encodeURIComponent('甲'));assert.equal(data.rows[0].rank,1)
scope=[];assert.equal((await get('view=directory')).total,0)
scope=['1001'];assert.equal((await request('server=1002')).status,403)
for(const query of ['view=evil','view=players&metric=average','page=-1','page=abc','metric=score;DROP'])assert.equal((await request(query)).status,400)
principal=null;assert.equal((await request('')).status,401)
db.close();console.log('PASS: auth, scoped ranking, ties, pagination, search rank preservation, guild isolation, missing metrics and average coverage')
