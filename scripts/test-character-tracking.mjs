import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
function load(path, deps = {}) {
 const exports = {}
 runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports, Response, TextEncoder, require: name => { assert.ok(name in deps, name); return deps[name] } })
 return exports
}
const db = new DatabaseSync(':memory:')
try {
 db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'))
 db.exec(readFileSync('migrations/0003_admin_users.sql', 'utf8'))
 db.exec(readFileSync('migrations/0004_agent_accounts_and_client_locks.sql', 'utf8'))
 db.exec(readFileSync('migrations/0011_character_combat_power.sql', 'utf8'))
 db.exec(readFileSync('migrations/0013_character_legion_leader.sql', 'utf8'))
 db.exec(readFileSync('migrations/0012_character_tracking.sql', 'utf8'))
 db.prepare('INSERT INTO game_characters(character_name,character_id,server_id,combat_power,is_legion_leader,first_seen_at,last_seen_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('重点甲', 'same-id', '1001', 1234, 1, 1, 1, 1)
 db.prepare('INSERT INTO game_characters(character_name,character_id,server_id,first_seen_at,last_seen_at,updated_at) VALUES (?,?,?,?,?,?)').run('重点乙', 'same-id', '1002', 1, 1, 1)
 db.prepare("INSERT INTO character_tracking(owner_user_key,character_db_id,notes,created_at,updated_at) VALUES('first',1,'keep-first',1,1),('later',1,'keep-later',2,2)").run()
 db.exec(readFileSync('migrations/0018_exclusive_character_tracking.sql','utf8'))
 assert.equal(db.prepare("SELECT active FROM character_tracking WHERE owner_user_key='first'").get().active,1)
 assert.equal(db.prepare("SELECT active FROM character_tracking WHERE owner_user_key='later'").get().active,0)
 assert.equal(db.prepare("SELECT notes FROM character_tracking_conflict_archive").get().notes,'keep-later')
 db.exec(readFileSync('migrations/0020_character_legion_position.sql','utf8'))
 db.exec('DELETE FROM character_tracking')
 const api = load('src/server/character-tracking.server.ts', {
  'cloudflare:workers': { env: { DB: { prepare: sql => ({ bind: (...args) => ({ all: async () => ({ results: db.prepare(sql).all(...args) }), first: async () => db.prepare(sql).get(...args), run: async () => ({ meta: db.prepare(sql).run(...args) }) }) }) } } },
  '#/lib/aion2-servers': load('src/lib/aion2-servers.ts'), '#/lib/game-characters': { avatarColorFor: () => '#123' },
 })
 const validation = load('src/lib/character-tracking.ts')
 const details = { action: 'update', characterId: 1, priority: 'high', status: 'waiting', notes: '明天跟进', nextFollowUp: 1900000000000 }
 assert.ok(validation.parseTrackingMutation(details))
 for (const bad of [{ priority: 'constructor' }, { status: 'invalid' }, { characterId: -1 }, { notes: 'x'.repeat(4001) }, { nextFollowUp: '123' }, { nextFollowUp: Infinity }]) assert.equal(validation.parseTrackingMutation({ ...details, ...bad }), null)
 assert.equal(await api.mutateTracking('alice', { action: 'add', characterId: 999 }), false)
 await api.mutateTracking('alice', { action: 'add', characterId: 1 })
 await api.mutateTracking('alice', { action: 'add', characterId: 2 })
 await api.mutateTracking('alice', details)
 assert.equal((await api.listTracking('bob')).length, 0)
 assert.equal(await api.mutateTracking('bob', details), false)
 await api.mutateTracking('bob', { action: 'remove', characterId: 1 })
 assert.equal((await api.listTracking('alice')).length, 2)
 await api.mutateTracking('alice', { action: 'remove', characterId: 1 })
 assert.equal((await api.listTracking('alice')).length, 1)
 await api.mutateTracking('alice', { action: 'add', characterId: 1 })
 const restored = (await api.listTracking('alice')).find(e => e.character.id === '1')
 assert.equal(restored.notes, details.notes)
 assert.equal(restored.priority, 'high')
 assert.equal(restored.character.combatPower, 1234)
 assert.equal(restored.character.legionPosition, 0)
 db.prepare('UPDATE game_characters SET character_name=?, combat_power=? WHERE id=1').run('新名字', 9999)
 assert.equal((await api.listTracking('alice')).find(e => e.character.id === '1').character.combatPower, 9999)
 let principal = null
 const { Route } = load('src/routes/api/character-tracking.ts', {
  '@tanstack/react-router': { createFileRoute: () => config => config }, '#/lib/character-tracking': validation,
  '#/server/admin-auth.server': { currentAdminPrincipal: async () => principal },
  '#/server/server-access.server': { allowedServerIds: async () => null, canAccessCharacter: async () => true },
  '#/server/api-auth.server': { jsonError: (error, status) => Response.json({ ok: false, error }, { status }) },
  '#/server/character-tracking.server': api,
 })
 const handlers = Route.server.handlers
 for (const method of ['GET', 'POST']) assert.equal((await handlers[method]({ request: new Request('https://test/api/character-tracking') })).status, 401)
 principal = { userKey: 'bob' }
 const post = body => handlers.POST({ request: new Request('https://test/api/character-tracking', { method: 'POST', body: JSON.stringify(body) }) })
 assert.equal((await post({ action: 'add', characterId: 1, owner_user_key: 'alice' })).status, 409)
 let occupied = await (await handlers.GET({request:new Request('https://test/api/character-tracking')})).json()
 assert.equal(occupied.entries.length,0)
 assert.equal(occupied.claims.find(c=>c.characterId==='1').isMine,false)
 assert.ok(!JSON.stringify(occupied.claims).includes(details.notes))
 assert.equal((await api.listTrackingClaims('bob', ['1002'])).length,1)
 assert.equal((await api.listTrackingClaims('bob', [])).length,0)
 await api.mutateTracking('alice', {action:'remove', characterId:1})
 assert.equal((await post({action:'add',characterId:1})).status,200)
 assert.equal(await api.mutateTracking('alice',{action:'add',characterId:1}),false)
 assert.equal(await api.mutateTracking('alice',details),false)
 const response = await handlers.GET({ request: new Request('https://test/api/character-tracking') })
 assert.equal(response.headers.get('Cache-Control'), 'no-store')
 const data = await response.json()
 assert.equal(data.entries.length, 1)
 assert.equal(data.entries[0].notes, '')
 assert.equal(data.entries[0].character.combatPower, 9999)
 assert.equal((await post({ ...details, priority: 'oops' })).status, 400)
 await api.mutateTracking('bob',{action:'remove',characterId:1})
 const race=await Promise.all([api.mutateTracking('a',{action:'add',characterId:1}),api.mutateTracking('b',{action:'add',characterId:1})])
 assert.equal(race.filter(Boolean).length,1)
 assert.throws(()=>db.prepare("INSERT INTO character_tracking(owner_user_key,character_db_id,created_at,updated_at) VALUES('bypass',1,1,1)").run(),/UNIQUE/)
 console.log('PASS: schema, validation, account isolation, restore, current character data, authenticated API and serialized fields')
} finally { db.close() }
