import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const db = new DatabaseSync(':memory:')
for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${file}`, 'utf8'))
db.exec('PRAGMA foreign_keys=ON')
db.exec("INSERT INTO game_characters(id,character_name,character_id,server_id,first_seen_at,last_seen_at,updated_at) VALUES(1,'old','c1','1001',1,1,1),(2,'other','c2','1002',1,1,1)")
let principal = { userKey: 'a' }, scope = ['1001']
const exports = {}
const deps = {
 'cloudflare:workers': { env: { DB: { prepare: sql => ({ bind: (...args) => ({ run: async () => ({ meta: db.prepare(sql).run(...args) }) }) }) } } },
 './admin-auth.server': { currentAdminPrincipal: async () => principal },
 './server-access.server': { allowedServerIds: async () => scope },
 './api-auth.server': { jsonError: (error,status) => Response.json({ok:false,error},{status}) },
}
runInNewContext(ts.transpileModule(readFileSync('src/server/character-edit.server.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,URL,require:n=>deps[n]})
const edit = (body, remove=false, origin) => exports.editCharacter(new Request('https://test/api/characters',{method:remove?'DELETE':'PATCH',headers:origin?{origin}:{},body:JSON.stringify(body)}),remove)
const input={id:1,name:'new',legionName:'guild',className:'ranger',faction:'天族',level:45,combatPower:8000,legionPosition:0}
assert.equal((await edit(input)).status,200)
assert.equal(db.prepare('SELECT character_name FROM game_characters WHERE id=1').get().character_name,'new')
for (const legionPosition of [0,1,2,3,null]) { assert.equal((await edit({...input,legionPosition})).status,200); assert.equal(db.prepare('SELECT legion_position FROM game_characters WHERE id=1').get().legion_position,legionPosition) }
for (const legionPosition of [-1,4,true,'0',1.5]) assert.equal((await edit({...input,legionPosition})).status,400)
assert.equal((await edit({...input,id:2})).status,409)
assert.equal((await edit({...input,level:-1})).status,400)
assert.equal((await edit(input,false,'https://evil.test')).status,403)
principal=null;assert.equal((await edit(input)).status,401);principal={userKey:'a'}
db.exec("INSERT INTO character_tracking(owner_user_key,character_db_id,created_at,updated_at) VALUES('b',1,1,1)")
assert.equal((await edit(input)).status,409)
assert.equal((await edit({id:1,confirm:true},true)).status,409)
db.exec("UPDATE character_tracking SET owner_user_key='a'")
db.exec("INSERT INTO chat_conversations(character_ref,owner_user_key,owner_username,created_at,updated_at) VALUES(1,'a','alice',1,1)")
assert.equal((await edit({id:1},true)).status,400)
assert.equal((await edit({id:1,confirm:true},true)).status,200)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_tracking').get().n,0)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_conversations').get().n,0)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_characters').get().n,1)
db.close()
console.log('PASS: edit, validation, authentication, server scope, tracking ownership, deletion confirmation and cascades')
