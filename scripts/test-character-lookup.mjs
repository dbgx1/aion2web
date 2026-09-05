import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function load(path, dependencies) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  runInNewContext(outputText, { exports, Response, URL, require(name) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`)
    return dependencies[name]
  } })
  return exports
}

test('exact lookup reaches off-page characters and isolates servers without counting the directory', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE game_characters (id INTEGER PRIMARY KEY, character_id TEXT, character_name TEXT,
      server_id TEXT, server_name TEXT, legion_name TEXT, level INTEGER, class_name TEXT, faction TEXT,
      avatar_url TEXT, last_seen_at INTEGER)`)
    const insert = db.prepare('INSERT INTO game_characters (id, character_id, character_name, server_id) VALUES (?, ?, ?, ?)')
    for (let id = 1; id <= 60; id++) insert.run(id, String(id), `Role ${id}`, '1001')
    insert.run(61, '60', 'Different server', '1002')
    insert.run(62, '62', 'Asmodian role', '2001')
    const queries = []
    const characters = load('../src/server/characters.server.ts', {
      'cloudflare:workers': { env: { DB: { prepare(sql) {
        queries.push(sql)
        return { bind(...args) { return {
          all: async () => ({ results: db.prepare(sql).all(...args) }),
          first: async () => db.prepare(sql).get(...args),
        } } }
      } } } },
      '#/lib/aion2-servers': load('../src/lib/aion2-servers.ts', {}),
    })
    const { Route } = load('../src/routes/api/characters.ts', {
      '@tanstack/react-router': { createFileRoute: () => options => options },
      '#/server/admin-auth.server': { isAdminRequest: async request => request.headers.has('cookie') },
      '#/server/api-auth.server': { jsonError: (error, status) => Response.json({ ok: false, error }, { status }) },
      '#/server/characters.server': characters,
    })
    for (const query of ['characterId=60', 'characterName=Role%2060']) {
      const response = await Route.server.handlers.GET({ request: new Request(
        `https://example.test/api/characters?serverId=1001&limit=2&includeTotal=0&${query}`,
        { headers: { Cookie: 'fixture-session' } },
      ) })
      assert.equal(response.status, 200)
      const result = await response.json()
      assert.equal(result.characters.length, 1)
      assert.equal(result.characters[0].id, 60)
      assert.equal(result.characters[0].serverId, '1001')
      assert.equal(result.totalCount, null)
    }
    assert.equal(queries.some(sql => sql.includes('COUNT(*)')), false)
    const before = queries.length
    const anonymous = await Route.server.handlers.GET({ request: new Request('https://example.test/api/characters?characterId=60') })
    assert.equal(anonymous.status, 401)
    assert.equal(queries.length, before)
    for (const [query, expectedCount] of [
      ['raceId=1', 61], ['raceId=2', 1], ['raceId=0', 62],
      ['raceId=2&serverId=1001', 0], ['raceId=2&bulk=1', null],
    ]) {
      const response = await Route.server.handlers.GET({ request: new Request(`https://example.test/api/characters?limit=100&${query}`, { headers: { Cookie: 'fixture' } }) })
      const result = await response.json()
      assert.equal(response.status, 200)
      assert.equal(result.totalCount, expectedCount)
      if (query.startsWith('raceId=2')) assert.ok(result.characters.every(character => character.serverId === '2001'))
      if (expectedCount !== null) assert.equal(result.characters.length, expectedCount)
    }
    let cursor = 0
    const ids = []
    do {
      const response = await Route.server.handlers.GET({ request: new Request(`https://example.test/api/characters?raceId=1&limit=20&cursor=${cursor}`, { headers: { Cookie: 'fixture' } }) })
      const result = await response.json()
      assert.equal(result.totalCount, 61)
      ids.push(...result.characters.map(character => character.id))
      cursor = result.nextCursor
    } while (cursor !== null)
    assert.equal(new Set(ids).size, 61)
    assert.ok(!ids.includes(62))
    for (const raceId of ['3', '-1', '1oops']) {
      const response = await Route.server.handlers.GET({ request: new Request(`https://example.test/api/characters?raceId=${raceId}`, { headers: { Cookie: 'fixture' } }) })
      assert.equal(response.status, 400)
    }
  } finally { db.close() }
})

test('authenticated bulk reads allow 1000 rows and never count; ordinary requests stay capped at 100', async () => {
  const queries = []
  const { Route } = load('../src/routes/api/characters.ts', {
    '@tanstack/react-router': { createFileRoute: () => options => options },
    '#/server/admin-auth.server': { isAdminRequest: async request => request.headers.has('cookie') },
    '#/server/api-auth.server': { jsonError: (error, status) => Response.json({ ok: false, error }, { status }) },
    '#/server/characters.server': { listCharacters: async query => {
      queries.push(query)
      return { characters: [], nextCursor: null, totalCount: query.includeTotal ? 0 : null }
    } },
  })
  for (const [params, limit, includeTotal] of [
    ['limit=100000&bulk=1&includeTotal=1', 1000, false],
    ['limit=100000', 100, true],
    ['cursor=100&includeTotal=0', 50, false],
  ]) {
    const response = await Route.server.handlers.GET({ request: new Request(`https://example.test/api/characters?${params}`, { headers: { Cookie: 'fixture' } }) })
    assert.equal(response.status, 200)
    assert.equal(queries.at(-1).limit, limit)
    assert.equal(queries.at(-1).includeTotal, includeTotal)
    assert.equal((await response.json()).totalCount, includeTotal ? 0 : null)
  }
  const response = await Route.server.handlers.GET({ request: new Request('https://example.test/api/characters?bulk=1') })
  assert.equal(response.status, 401)
  assert.equal(queries.length, 3)
})
