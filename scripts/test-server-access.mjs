import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { z } from 'zod'
const db = new DatabaseSync(':memory:')
const DB = { batch: async statements => Promise.all(statements.map(statement => statement.run())), prepare(sql) {
  const query = (args = []) => ({ bind: (...values) => query(values),
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: db.prepare(sql).run(...args) }),
  }); return query()
} }
function load(path, deps = {}) {
  deps = { '#/server/character-edit.server': { editCharacter: () => assert.fail('Directory access tests must not mutate characters') }, ...deps }
  const exports = {}
  runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Response, Request, URL, TextEncoder, TextDecoder, crypto, btoa, atob, require(name) { assert.ok(name in deps, name); return deps[name] } })
  return exports
}
let principal = { userKey: 'env:admin', username: 'admin', role: 'admin' }
const auth = { currentAdminPrincipal: async () => principal }
const error = { jsonError: (error, status) => Response.json({ ok: false, error }, { status }) }
const router = { createFileRoute: () => config => config }
try {
  for (const file of readdirSync('migrations').filter(name => name.endsWith('.sql') && !name.startsWith('0017_')).sort()) db.exec(readFileSync(`migrations/${file}`, 'utf8'))
  for (const name of ['alice', 'bob']) db.prepare(`INSERT INTO admin_users(username,username_normalized,password_hash,password_salt,password_iterations,role,status,created_at,updated_at) VALUES(?,?, 'x','x',100000,'agent','active',1,1)`).run(name, name)
  for (const server of ['1001', '1002', '1003']) db.prepare(`INSERT INTO game_characters(character_name,character_id,server_id,first_seen_at,last_seen_at,updated_at) VALUES(?,?,?,1,1,1)`).run(`角色${server}`, 'same-id', server)
  db.prepare("INSERT INTO server_assignments(server_id,user_id,version,updated_by,updated_at) VALUES('legacy',1,7,'admin',1)").run()
  db.exec(readFileSync('migrations/0017_shared_server_assignments.sql','utf8'))
  assert.equal(db.prepare("SELECT user_ids FROM server_assignments WHERE server_id='legacy'").get().user_ids,'[1]')
  assert.equal(db.prepare("SELECT version FROM server_assignments WHERE server_id='legacy'").get().version,7)
  db.exec("DELETE FROM server_assignments WHERE server_id='legacy'; DELETE FROM server_assignment_audit; DELETE FROM server_assignment_membership_audit;")
  const servers = load('src/lib/aion2-servers.ts')
  const characters = load('src/server/characters.server.ts', { 'cloudflare:workers': { env: { DB } }, '#/lib/aion2-servers': servers })
  const access = load('src/server/server-access.server.ts', { 'cloudflare:workers': { env: { DB } } })
  const accounts = load('src/routes/api/admin/accounts.ts', { '@tanstack/react-router': router, 'cloudflare:workers': { env: { DB } }, zod: { z }, '#/server/admin-auth.server': auth, '#/server/admin-users.server': { registerAdminUser: async () => ({ ok: true }) }, '#/server/characters.server': characters, '#/server/api-auth.server': error }).Route.server.handlers
  const request = (path, body, origin = 'https://test') => new Request(`https://test${path}`, body ? { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const registration = load('src/routes/api/auth/register.ts', { '@tanstack/react-router': router, '#/server/api-auth.server': error }).Route.server.handlers
  assert.equal(registration.POST().status, 410)

  const alice = { userKey: 'user:1', username: 'alice', role: 'agent' }
  const bob = { userKey: 'user:2', username: 'bob', role: 'agent' }
  // A stale assignment must not narrow anyone's access, including a new account.
  db.prepare("INSERT INTO server_assignments(server_id,user_id,user_ids,version,updated_by,updated_at) VALUES('1001',1,'[1]',1,'admin',1)").run()
  const directory = load('src/routes/api/characters.ts', { '@tanstack/react-router': router, '#/server/admin-auth.server': auth, '#/server/server-access.server': access, '#/server/api-auth.server': error, '#/server/characters.server': characters }).Route.server.handlers
  const serverAccessRoute = load('src/routes/api/server-access.ts', { '@tanstack/react-router': router, '#/server/admin-auth.server': auth,
    '#/server/server-access.server': access, '#/server/api-auth.server': error }).Route.server.handlers
  const checkServer = serverId => serverAccessRoute.GET({ request: request(`/api/server-access?serverId=${serverId}`) })
  for (const user of [alice, bob, principal]) {
    principal = user
    assert.equal(await access.allowedServerIds(user), null)
    for (const serverId of ['1001', '1003', '1305', '9999']) assert.equal((await checkServer(serverId)).status, 200)
    assert.equal((await checkServer('')).status, 400)
    const list = await (await directory.GET({ request: request('/api/characters') })).json()
    assert.equal(list.totalCount, 3)
    const filtered = await (await directory.GET({ request: request('/api/characters?serverId=1003&bulk=1') })).json()
    assert.equal(filtered.characters.length, 1)
    const catalog = await (await directory.GET({ request: request('/api/characters?directory=1') })).json()
    assert.equal(catalog.servers.length, servers.AION2_SERVERS.length + 3)
  }
  principal = bob
  assert.equal((await accounts.GET({ request: request('/api/admin/accounts') })).status, 403)
  assert.equal((await accounts.POST({ request: request('/api/admin/accounts', { action: 'create', username: 'forged', password: 'password123' }) })).status, 403)
  principal = { userKey: 'env:admin', username: 'admin', role: 'admin' }
  assert.equal((await accounts.POST({ request: request('/api/admin/accounts', { action: 'assign', serverId: '1003', userIds: [2], version: 0 }) })).status, 400)
  assert.equal((await accounts.POST({ request: request('/api/admin/accounts', { action: 'status', userId: 2, status: 'disabled' }, 'https://evil') })).status, 403)
  const listed = await (await accounts.GET({ request: request('/api/admin/accounts') })).json()
  assert.equal(listed.users.length, 2)
  assert.equal('assignments' in listed, false)
  assert.equal((await accounts.POST({ request: request('/api/admin/accounts', { action: 'status', userId: 2, status: 'disabled' }) })).status, 200)
  const users = load('src/server/admin-users.server.ts', { 'cloudflare:workers': { env: { DB } } })
  assert.equal(await users.refreshAdminPrincipal(bob), null)
  assert.equal((await users.refreshAdminPrincipal({ ...alice, role: 'admin' })).role, 'agent')
  // Same authentication refresh used by every HTTP route rejects a disabled account.
  principal = await users.refreshAdminPrincipal(bob)
  assert.equal((await checkServer('1001')).status, 401)
  assert.equal((await directory.GET({ request: request('/api/characters') })).status, 401)
  assert.equal((await accounts.GET({ request: request('/api/admin/accounts') })).status, 401)
  assert.equal((await accounts.POST({ request: request('/api/admin/accounts', { action: 'create', username: 'forged', password: 'password123' }) })).status, 401)
  console.log('PASS: all active accounts see all servers; legacy assignments ignored; retired assignment API; login, disabled account, admin role and origin protections retained')
} finally { db.close() }
