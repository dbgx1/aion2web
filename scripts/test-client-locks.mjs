import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function load(path, dependencies = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  runInNewContext(outputText, { exports, Response, ...globals, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`)
    return dependencies[name]
  } })
  return exports
}

test('lock persists without renewal, only its owner can exit, stale exits cannot release a new acquisition', async () => {
  const db = new DatabaseSync(':memory:')
  let now = 100_000
  const alice = { userKey: 'a', username: 'Alice', role: 'agent' }
  const bob = { userKey: 'b', username: 'Bob', role: 'agent' }
  try {
    db.exec('CREATE TABLE client_locks (agent_id TEXT PRIMARY KEY, user_key TEXT, username TEXT, acquired_at INTEGER, expires_at INTEGER, updated_at INTEGER)')
    const service = load('../src/server/client-locks.server.ts', { 'cloudflare:workers': { env: { DB: { prepare(sql) {
      const execute = args => ({
        run: async () => db.prepare(sql).run(...args),
        first: async () => db.prepare(sql).get(...args),
        all: async () => ({ results: db.prepare(sql).all(...args) }),
      })
      return { ...execute([]), bind: (...args) => execute(args) }
    } } } } }, { Date: { now: () => now } })
    const first = await service.acquireClientLock('A1', alice)
    assert.equal(first.ok, true)
    now += 3600_000
    assert.equal((await service.listClientLocks()).length, 1)
    assert.equal((await service.acquireClientLock('A1', bob)).ok, false)
    assert.equal((await service.acquireClientLock('A2', alice)).ok, false)
    assert.equal((await service.listClientLocks())[0].agentId, 'A1')
    await service.releaseClientLock('A1', bob, first.lock.acquiredAt)
    assert.equal((await service.listClientLocks()).length, 1)
    await service.releaseClientLock('A1', alice, first.lock.acquiredAt)
    assert.equal((await service.listClientLocks()).length, 0)
    const next = await service.acquireClientLock('A1', bob)
    await service.releaseClientLock('A1', alice, first.lock.acquiredAt)
    await service.releaseOfflineClientLock('A1', now - 1000, bob)
    assert.equal((await service.listClientLocks()).length, 1)
    const oldAcquisition = next.lock.acquiredAt
    now += 1
    const renewed = await service.acquireClientLock('A1', bob)
    assert.equal(renewed.lock.acquiredAt, oldAcquisition, 'Same-owner acquisition must not invalidate running automation')
    await service.releaseClientLock('A1', bob, oldAcquisition)
    now += 1
    const reacquired = await service.acquireClientLock('A1', bob)
    assert.notEqual(reacquired.lock.acquiredAt, oldAcquisition, 'Explicit exit and re-acquisition must create a new generation')
    await service.releaseClientLock('A1', bob, oldAcquisition)
    assert.equal((await service.listClientLocks()).length, 1)

    const { Route } = load('../src/routes/api/client-locks.ts', {
      '@tanstack/react-router': { createFileRoute: () => options => options },
      '#/server/admin-auth.server': { currentAdminPrincipal: async request => request.headers.has('cookie') ? bob : null },
      '#/server/client-locks.server': service,
      '#/server/api-auth.server': { jsonError: (error, status) => Response.json({ error }, { status }) },
    })
    const send = (method, body, authenticated = true) => Route.server.handlers[method]({ request: new Request('https://example.test/api/client-locks', {
      method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: 'test' } : {}) }, body: JSON.stringify(body),
    }) })
    assert.equal((await send('POST', { agentId: 'A1', action: 'release' })).status, 400)
    assert.equal((await send('DELETE', { agentId: 'A1' })).status, 400)
    assert.equal((await send('POST', { agentId: 'A1', action: 'offline', offlineAt: now }, false)).status, 401)
    assert.equal((await service.listClientLocks()).length, 1)
    assert.equal((await send('POST', { agentId: 'A1', action: 'page_exit', acquiredAt: reacquired.lock.acquiredAt })).status, 200)
    assert.equal((await service.listClientLocks()).length, 1, 'Even a legacy tab with the current generation cannot release shared ownership on pagehide')
    assert.equal((await send('DELETE', { agentId: 'A1', action: 'manual_exit', acquiredAt: reacquired.lock.acquiredAt })).status, 200)
    assert.equal((await service.listClientLocks()).length, 0)
    now += 1
    await service.acquireClientLock('A1', alice)
    now += 1000
    await send('POST', { agentId: 'A1', action: 'offline', offlineAt: now })
    assert.equal((await service.listClientLocks()).length, 1, 'Another operator cannot release this client based on its own missing heartbeats')
    await service.releaseOfflineClientLock('A1', now, alice)
    assert.equal((await service.listClientLocks()).length, 0)
  } finally { db.close() }
})

test('only uninterrupted live monitoring may infer a game-client heartbeat timeout', () => {
  const { ClientOfflineMonitor } = load('../src/lib/client-offline.ts')
  const monitor = new ClientOfflineMonitor(15_000)
  monitor.observe('A1', 1000)
  for (let now = 1000; now < 30_000; now += 3000) assert.equal(monitor.sweep(false, now).length, 0)
  assert.equal(monitor.sweep(true, 31_000).length, 0)
  assert.equal(monitor.sweep(true, 80_000).length, 0, 'Browser suspension must restart observation')
  for (let now = 83_000; now <= 95_000; now += 3000) assert.equal(monitor.sweep(true, now).length, 0)
  assert.deepEqual(Array.from(monitor.sweep(true, 98_000)), ['A1'])
  monitor.observe('A2', 100_000)
  monitor.forget('A2')
  assert.equal(monitor.sweep(true, 103_000).length, 0)
})
