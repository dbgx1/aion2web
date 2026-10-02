import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function load(path, deps = {}) {
  const exports = {}
  runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Response, URL, TextDecoder, require: name => {
    assert.ok(name in deps, name)
    return deps[name]
  } })
  return exports
}

const parser = load('src/lib/character-upload.ts')
const base = { characterName: 'Fixture', characterId: '282882351594449880', serverId: '1005' }
for (const [key, values] of [
  ['equipItemLevel', [-1, 1.5, 2147483648, true, false, [], {}, '', ' ', '1.5', '0x10', Infinity, NaN]],
  ['gender', [-1, 3, 1.5, true, false, [], {}, '', ' ', '男', Infinity, NaN]],
]) for (const value of values) {
  const result = parser.parseCharacterUpload({ ...base, [key]: value }, 7)
  assert.equal(result.ok, false, `${key}: ${String(value)}`)
  assert.ok(result.error.includes(`characters[7].${key}`))
}
assert.equal(parser.parseCharacterUpload({ ...base, equip_item_level: '2147483647' }, 0).value.equipItemLevel, 2147483647)
for (const gender of [0, 1, 2, '0', '1', '2']) {
  assert.equal(parser.parseCharacterUpload({ ...base, gender }, 0).value.gender, Number(gender))
}

const db = new DatabaseSync(':memory:')
try {
  const migrations = readdirSync('migrations').filter(n => n.endsWith('.sql')).sort()
  for (const file of migrations.filter(n => n < '0021')) db.exec(readFileSync(`migrations/${file}`, 'utf8'))
  db.exec("INSERT INTO game_characters(character_name,character_id,server_id,first_seen_at,last_seen_at,updated_at) VALUES('Legacy','old','1005',1,1,1)")
  db.exec(readFileSync('migrations/0021_character_equipment_gender.sql', 'utf8'))
  assert.deepEqual({ ...db.prepare("SELECT equip_item_level,gender FROM game_characters WHERE character_id='old'").get() }, { equip_item_level: null, gender: null })
  for (const sql of ['gender=3', 'gender=1.5', 'equip_item_level=-1', 'equip_item_level=1.5', 'equip_item_level=2147483648']) {
    assert.throws(() => db.exec(`UPDATE game_characters SET ${sql}`))
  }
  const servers = load('src/lib/aion2-servers.ts')
  const service = load('src/server/characters.server.ts', {
    '#/lib/aion2-servers': servers,
    'cloudflare:workers': { env: { UPLOAD_API_TOKEN: 'fixture', DB: {
      prepare: sql => ({ bind: (...args) => ({ sql, args,
        all: async () => ({ results: db.prepare(sql).all(...args) }),
        first: async () => db.prepare(sql).get(...args),
      }) }),
      batch: async statements => statements.map(({ sql, args }) => ({ meta: db.prepare(sql).run(...args) })),
    } } },
  })
  const dependencies = {
    '#/server/request-body.server': load('src/server/request-body.server.ts'),
    '@tanstack/react-router': { createFileRoute: () => options => options },
    '#/lib/character-upload': parser,
    '#/lib/aion2-servers': servers,
    '#/server/characters.server': service,
    '#/server/admin-auth.server': { currentAdminPrincipal: async req => req.headers.has('cookie') ? { role: 'admin' } : null },
    '#/server/api-auth.server': {
      verifyBearerToken: async req => req.headers.get('authorization') === 'Bearer fixture',
      jsonError: (error, status, details) => Response.json({ ok: false, error, details }, { status }),
    },
    '#/server/server-access.server': { allowedServerIds: async () => null, canAccessServer: async () => true },
    '#/server/character-edit.server': { editCharacter: () => assert.fail('Unexpected edit') },
  }
  const uploadRoute = load('src/routes/api/characters/upload.ts', dependencies).Route
  const listRoute = load('src/routes/api/characters.ts', dependencies).Route
  const serverRoute = load('src/routes/api/servers/$serverId/characters.ts', dependencies).Route
  const post = (characters, authorized = true) => uploadRoute.server.handlers.POST({ request: new Request('https://test/api/characters/upload', {
    method: 'POST', headers: authorized ? { authorization: 'Bearer fixture' } : {}, body: JSON.stringify({ characters }),
  }) })
  const upload = async extra => {
    const response = await post([{ ...base, ...extra }])
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, received: 1, written: 1 })
  }
  const row = () => db.prepare('SELECT equip_item_level,gender FROM game_characters WHERE character_id=? AND server_id=?').get(base.characterId, base.serverId)
  await upload({ equipItemLevel: 3000, gender: 2 })
  assert.deepEqual({ ...row() }, { equip_item_level: 3000, gender: 2 })
  for (const extra of [{}, { equipItemLevel: null, gender: null }]) {
    await upload(extra)
    assert.deepEqual({ ...row() }, { equip_item_level: 3000, gender: 2 })
  }
  await upload({ equipItemLevel: 0, gender: 0 })
  assert.deepEqual({ ...row() }, { equip_item_level: 0, gender: 0 })
  await upload({ equip_item_level: '3100', gender: '1' })
  assert.deepEqual({ ...row() }, { equip_item_level: 3100, gender: 1 })
  assert.equal((await post([{ ...base, gender: 2 }], false)).status, 401)
  assert.equal((await post([{ ...base, gender: 2 }, { ...base, characterId: 'bad', equipItemLevel: -1 }])).status, 400)
  assert.equal(row().gender, 1, 'Invalid batches must not partially update data')
  assert.equal(db.prepare("SELECT count(*) AS n FROM game_characters WHERE character_id='bad'").get().n, 0)
  await upload({ serverId: '1006', equipItemLevel: 42, gender: 2 })
  assert.equal(row().equip_item_level, 3100, 'The same game ID on another server remains isolated')
  const responses = [
    await listRoute.server.handlers.GET({ request: new Request('https://test/api/characters?serverId=1005', { headers: { cookie: 'fixture' } }) }),
    await serverRoute.server.handlers.GET({ params: { serverId: '1005' }, request: new Request('https://test/api/servers/1005/characters', { headers: { authorization: 'Bearer fixture' } }) }),
  ]
  for (const response of responses) {
    assert.equal(response.status, 200)
    const payload = await response.json()
    const current = payload.characters.find(c => c.characterId === base.characterId)
    assert.equal(current.equipItemLevel, 3100)
    assert.equal(current.gender, 1)
    const legacy = payload.characters.find(c => c.characterId === 'old')
    assert.equal(legacy.equipItemLevel, null)
    assert.equal(legacy.gender, null)
  }
  console.log('PASS: migration, bounds, aliases, zero/null/legacy updates, batch rejection, authentication, server isolation and both serialized query responses')
} finally { db.close() }
