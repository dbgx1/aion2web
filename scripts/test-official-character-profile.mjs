import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function load(file, dependencies, globals = {}) {
  const exports = {}
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  runInNewContext(outputText, { exports, require: name => {
    assert.ok(name in dependencies, `Unexpected import ${name}`)
    return dependencies[name]
  }, URL, URLSearchParams, Response, AbortSignal, TextDecoder, ...globals })
  return exports
}
const servers = load('src/lib/aion2-servers.ts', {})
function harness(upstream, { principal = null, allowed = true } = {}) {
  const calls = []
  const provider = load('src/server/official-character.server.ts', { '#/lib/aion2-servers': servers }, {
    fetch: async (url, init) => { calls.push({ url, init }); return upstream(url, init) },
  })
  const { Route } = load('src/routes/api/characters/profile.ts', {
    '@tanstack/react-router': { createFileRoute: () => options => options },
    '#/server/admin-auth.server': { currentAdminPrincipal: async () => principal },
    '#/server/server-access.server': { canAccessServer: async () => allowed },
    '#/server/characters.server': { uploadToken: () => 'fixture-token' },
    '#/server/api-auth.server': {
      verifyBearerToken: async request => request.headers.get('Authorization') === 'Bearer fixture-token',
      jsonError: (error, status) => Response.json({ ok: false, error }, { status }),
    },
    '#/server/official-character.server': provider,
  })
  return { calls, provider, get: (query, auth = true) => Route.server.handlers.GET({ request: new Request(
    `https://local.test/api/characters/profile?${query}`,
    { headers: auth ? { Authorization: 'Bearer fixture-token' } : {} },
  ) }) }
}

const query = 'serverId=2201&characterName=wangjw98'
function fixture(url) {
  if (url.pathname.includes('/search/')) return Response.json({ list: [
    { name: 'wangjw98', serverId: 2501, characterId: 'wrong' },
    { name: '<strong>wangjw98</strong>', serverId: 2201, characterId: 'opaque%3D', level: 9, race: 2, serverName: 'Israphel' },
  ] })
  if (url.pathname.endsWith('/info')) return Response.json({
    profile: { characterName: 'wangjw98', serverId: 2201, characterLevel: 11, combatPower: 3696, className: 'Ranger' },
    stat: { statList: [{ name: 'Item Level', type: 'ItemLevel', value: 6 }] },
  })
  return Response.json({ equipment: { equipmentList: [{ name: 'Training Bow', enchantLevel: 1 }] }, skill: { skillList: [] } })
}

test('anonymous and out-of-scope callers never reach upstream, even with bearer + restricted session', async () => {
  const anonymous = harness(fixture)
  assert.equal((await anonymous.get(query, false)).status, 401)
  assert.equal(anonymous.calls.length, 0)
  const restricted = harness(fixture, { principal: { role: 'agent' }, allowed: false })
  assert.equal((await restricted.get(query)).status, 403)
  assert.equal(restricted.calls.length, 0)
})
test('GLOBAL auto-detection uses official upstream, correct subregion and single ID encoding', async () => {
  const h = harness(fixture)
  const response = await h.get(query)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.region, 'GLOBAL')
  assert.equal(body.subRegion, 'naw')
  assert.equal(body.source, 'ncsoft')
  assert.equal(body.partial, false)
  assert.equal(body.profile.level, 11)
  assert.equal(body.profile.combatPower, 3696)
  assert.equal(body.profile.itemLevel, 6)
  assert.equal(body.profile.equipment[0].name, 'Training Bow')
  assert.equal(h.calls.length, 3)
  assert.equal(h.calls[0].url.hostname, 'api-search.plaync.com')
  assert.equal(h.calls[0].url.searchParams.get('region'), 'naw')
  assert.equal(h.calls[1].url.hostname, 'aion2.plaync.com')
  assert.equal(h.calls[1].url.searchParams.get('characterId'), 'opaque=')
  assert.equal(h.calls[1].url.searchParams.get('region'), 'naw')
  for (const call of h.calls) {
    assert.equal(call.init.headers.Authorization, undefined)
    assert.equal(call.init.headers.Cookie, undefined)
    assert.equal(call.init.redirect, 'manual')
  }
  assert.equal(response.headers.get('cache-control'), 'no-store')
})
test('all five global regions, explicit mismatches, TW backwards compatibility', async () => {
  const h = harness(fixture)
  for (const [server, subregion] of [['1101', 'nae'], ['2201', 'naw'], ['1301', 'eu'], ['2401', 'la'], ['1501', 'as']]) {
    assert.equal(h.provider.officialCharacterSource(server, 'GLOBAL').subRegion, subregion)
  }
  for (const bad of ['serverId=2201&region=TW', 'serverId=1001&region=GLOBAL', 'serverId=2201&region=KR', 'serverId=9999', 'serverId=2201oops']) {
    assert.equal((await h.get(`${bad}&characterName=test`)).status, 400)
  }
  assert.equal(h.calls.length, 0)
  const tw = harness(url => {
    if (url.pathname.includes('/search/')) {
      assert.equal(url.searchParams.get('race'), '1')
      return Response.json({ list: [{ name: 'Taiwan', serverId: 1001, characterId: 'tw%3D' }] })
    }
    if (url.pathname.endsWith('/info')) return Response.json({ profile: { characterName: 'Taiwan', serverId: 1001, characterLevel: 50 } })
    return Response.json({ equipment: { equipmentList: [] }, skill: { skillList: [] } })
  }, { principal: { role: 'admin' } })
  const result = await (await tw.get('serverId=1001&characterName=Taiwan', false)).json()
  assert.equal(result.profile.level, 50)
  assert.equal(result.region, 'TW')
  assert.ok(tw.calls.every(c => c.url.hostname === 'tw.ncsoft.com'))
})
test('not found differs from malformed or failed search', async () => {
  const missing = harness(() => Response.json({ list: [] }))
  assert.deepEqual(await (await missing.get(query)).json(), { ok: true, found: false })
  assert.equal(missing.calls.length, 1)
  for (const upstream of [() => Response.json({ error: 'oops' }), () => new Response('html'), () => { throw new Error('timeout') }]) {
    assert.equal((await harness(upstream).get(query)).status, 502)
  }
  assert.equal((await harness(() => new Response('', { status: 429 })).get(query)).status, 503)
})
test('details must match requested character; equipment failure is explicitly partial', async () => {
  const mismatch = harness(url => url.pathname.endsWith('/info') ? Response.json({ profile: { serverId: 2501, characterName: 'Other' } }) : fixture(url))
  assert.equal((await mismatch.get(query)).status, 502)
  const failed = harness(url => url.pathname.endsWith('/info') ? new Response('', { status: 500 }) : fixture(url))
  assert.equal((await failed.get(query)).status, 502)
  const partial = harness(url => url.pathname.endsWith('/equipment') ? new Response('', { status: 503 }) : fixture(url))
  const result = await (await partial.get(query)).json()
  assert.equal(result.found, true)
  assert.equal(result.partial, true)
  assert.equal(result.warnings.length, 1)
  assert.equal(result.profile.combatPower, 3696)
  assert.deepEqual(result.profile.equipment, [])
})
test('oversized upstream responses fail instead of buffering without a limit', async () => {
  assert.equal((await harness(() => new Response('x'.repeat(2_000_001))).get(query)).status, 502)
})

test('upstream redirects are rejected and never followed to another host', async () => {
  const h = harness(() => new Response(null, { status: 302, headers: { Location: 'https://untrusted.test/' } }))
  assert.equal((await h.get(query)).status, 502)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].init.redirect, 'manual')
})

if (process.argv.includes('--live')) {
  test('live official GLOBAL query through the actual route handler', async () => {
    const h = harness(fetch)
    const response = await h.get(query)
    const body = await response.json()
    assert.equal(response.status, 200, JSON.stringify(body))
    assert.equal(body.profile.name, 'wangjw98')
    assert.equal(body.profile.serverId, '2201')
    assert.equal(body.region, 'GLOBAL')
    assert.equal(body.partial, false)
    assert.ok(body.profile.equipment.length)
    writeFileSync('artifacts/global-profile-live-result.json', JSON.stringify(body, null, 2))
    console.log(JSON.stringify({ name: body.profile.name, server: body.profile.serverId, level: body.profile.level, combatPower: body.profile.combatPower, equipment: body.profile.equipment.length }))
  })
}
