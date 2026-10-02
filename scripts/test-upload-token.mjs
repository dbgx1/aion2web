import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { webcrypto, timingSafeEqual } from 'node:crypto'
import ts from 'typescript'

const token = 'test-only-upload-token-not-a-production-secret'
const env = { UPLOAD_API_TOKEN: token }
const crypto = { subtle: {
  importKey: (...args) => webcrypto.subtle.importKey(...args),
  sign: (...args) => webcrypto.subtle.sign(...args),
  digest: (...args) => webcrypto.subtle.digest(...args),
  timingSafeEqual: (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b)),
} }
function load(path, deps) {
  const exports = {}
  runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Response, Request, URL, TextEncoder, TextDecoder, crypto, btoa, atob,
    require(name) { assert.ok(name in deps, name); return deps[name] },
  })
  return exports
}
const characters = { uploadToken: () => env.UPLOAD_API_TOKEN }
const auth = load('src/server/admin-auth.server.ts', {
  'cloudflare:workers': { env },
  '#/server/characters.server': characters,
  '#/server/admin-users.server': {
    refreshAdminPrincipal: async principal => principal.userKey === 'disabled' ? null : principal,
    verifyRegisteredAdminCredentials: () => assert.fail('No login mutation expected'),
  },
})
const handler = load('src/routes/api/admin/upload-token.ts', {
  '@tanstack/react-router': { createFileRoute: () => config => config },
  '#/server/admin-auth.server': auth,
  '#/server/characters.server': characters,
}).Route.server.handlers.GET

async function check(headers, status, expectedToken) {
  const response = await handler({ request: new Request('https://test/api/admin/upload-token', { headers }) })
  assert.equal(response.status, status)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(response.headers.get('Vary'), 'Cookie')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  const data = await response.json()
  if (expectedToken) assert.deepEqual(data, { ok: true, token: expectedToken })
  else { assert.equal(data.ok, false); assert.equal('token' in data, false); assert.ok(!JSON.stringify(data).includes(token)) }
}
const cookie = value => ({ cookie: `aion_admin_session=${value}` })
await check({}, 401)
await check({ Authorization: `Bearer ${token}` }, 401)
await check(cookie('forged-session'), 401)
const adminSession = await auth.createAdminSession()
await check(cookie(`${adminSession}tampered`), 401)
await check(cookie(adminSession.replace(/^v2:\d+:/, 'v2:1:')), 401)
const agentSession = await auth.createAdminSession({ userKey: 'user:1', username: 'agent', role: 'agent' })
await check(cookie(agentSession), 403)
const disabledSession = await auth.createAdminSession({ userKey: 'disabled', username: 'disabled', role: 'admin' })
await check(cookie(disabledSession), 401)
await check(cookie(adminSession), 200, token)

// Missing configuration with a verified administrator must not return a fake token.
env.UPLOAD_API_TOKEN = ''
const missingHandler = load('src/routes/api/admin/upload-token.ts', {
  '@tanstack/react-router': { createFileRoute: () => config => config },
  '#/server/admin-auth.server': { currentAdminPrincipal: async () => ({ role: 'admin' }) },
  '#/server/characters.server': characters,
}).Route.server.handlers.GET
const missing = await missingHandler({ request: new Request('https://test/api/admin/upload-token') })
assert.equal(missing.status, 503)
assert.equal(missing.headers.get('Cache-Control'), 'private, no-store')
assert.equal('token' in await missing.json(), false)
console.log('PASS: admin reads exact runtime token; anonymous, bearer-only, forged, expired, agent and disabled sessions denied; no caching; missing configuration handled')
