import assert from 'node:assert/strict'
import { timingSafeEqual, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const token = 'test-upload-token'
const crypto = {
  subtle: {
    digest: webcrypto.subtle.digest.bind(webcrypto.subtle),
    importKey: webcrypto.subtle.importKey.bind(webcrypto.subtle),
    sign: webcrypto.subtle.sign.bind(webcrypto.subtle),
    timingSafeEqual: (left, right) => timingSafeEqual(Buffer.from(left), Buffer.from(right)),
  },
}

function loadModule(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  runInNewContext(outputText, {
    exports, crypto, TextEncoder, TextDecoder, URL, Response, btoa, atob,
    require: (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  })
  return exports
}

const apiAuth = loadModule('../src/server/api-auth.server.ts', {})
const characters = { uploadToken: () => token }
const adminAuth = loadModule('../src/server/admin-auth.server.ts', {
  'cloudflare:workers': { env: {} },
  '#/server/admin-users.server': {},
  '#/server/characters.server': characters,
})

test('server character route accepts Bearer or session and rejects unauthenticated reads', async () => {
  let reads = 0
  const { Route } = loadModule('../src/routes/api/servers/$serverId/characters.ts', {
    '@tanstack/react-router': { createFileRoute: () => (options) => options },
    '#/lib/aion2-servers': { AION2_SERVERS: [], aion2ServerName: () => '' },
    '#/server/admin-auth.server': adminAuth,
    '#/server/api-auth.server': apiAuth,
    '#/server/characters.server': {
      ...characters,
      listCharacters: async (input) => {
        reads += 1
        assert.equal(input.serverId, '1001')
        assert.equal(input.limit, 500)
        assert.equal(input.cursor, 42)
        return { characters: [{ characterId: '123' }], nextCursor: 43, hasMore: true, totalCount: null }
      },
    },
  })
  const session = await adminAuth.createAdminSession()
  for (const [headers, status] of [
    [{}, 401],
    [{ Authorization: 'Bearer wrong-token' }, 401],
    [{ Authorization: 'Bearer ' }, 401],
    [{ Cookie: 'aion_admin_session=invalid' }, 401],
    [{ Authorization: `Bearer ${token}` }, 200],
    [{ Cookie: `aion_admin_session=${session}` }, 200],
    [{ Cookie: 'aion_admin_session=invalid', Authorization: `Bearer ${token}` }, 200],
  ]) {
    const before = reads
    const response = await Route.server.handlers.GET({
      request: new Request('https://example.test/api/servers/1001/characters?limit=500&cursor=42', { headers }),
      params: { serverId: '1001' },
    })
    assert.equal(response.status, status)
    const body = await response.json()
    assert.equal(body.ok, status === 200)
    assert.equal(reads - before, status === 200 ? 1 : 0)
    if (status === 200) {
      assert.equal(body.characters[0].characterId, '123')
      assert.equal(body.page.nextCursor, 43)
    }
  }
})

test('missing configured token never grants Bearer access', async () => {
  for (const expected of ['', undefined, '   ']) {
    for (const authorization of ['', 'Bearer ', `Bearer ${token}`]) {
      const request = new Request('https://example.test', { headers: { authorization } })
      assert.equal(await apiAuth.verifyBearerToken(request, expected), false)
    }
  }
})
