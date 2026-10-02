import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(path, imports = {}, globals = {}) {
  const exports = {}
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(source, { exports, require: name => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`)
    return imports[name]
  }, Response, ...globals })
  return exports
}

let requests = 0
let response = () => Response.json({})
const client = load('../src/lib/private-mqtt.ts', {}, { fetch: async (url, options) => {
  requests++
  assert.equal(url, '/api/mqtt/connection')
  assert.equal(options.cache, 'no-store')
  assert.equal(options.credentials, 'same-origin')
  return response()
} })
assert.equal(client.migrateMqttUrl(null), client.PRIVATE_MQTT_URL)
assert.equal(client.migrateMqttUrl(client.LEGACY_MQTT_URL), client.PRIVATE_MQTT_URL)
assert.equal(client.migrateMqttUrl('ws://127.0.0.1:9001'), 'ws://127.0.0.1:9001')
await client.privateMqttCredentials('wss://other.example/mqtt')
assert.equal(requests, 0, 'Credentials must never be fetched for a different broker')
response = () => Response.json({ error: 'Unauthorized' }, { status: 401 })
await assert.rejects(client.privateMqttCredentials(client.PRIVATE_MQTT_URL), /重新登录/)
response = () => Response.json({ url: 'wss://other.example/mqtt', username: 'u', password: 'p' })
await assert.rejects(client.privateMqttCredentials(client.PRIVATE_MQTT_URL), /配置无效/)
response = () => Response.json(null)
await assert.rejects(client.privateMqttCredentials(client.PRIVATE_MQTT_URL), /配置无效/)
response = () => Response.json({ url: client.PRIVATE_MQTT_URL, username: 'u', password: 'p' })
assert.equal((await client.privateMqttCredentials(client.PRIVATE_MQTT_URL)).username, 'u')

let principal = null
const env = {}
const route = load('../src/routes/api/mqtt/connection.ts', {
  '@tanstack/react-router': { createFileRoute: () => value => value },
  'cloudflare:workers': { env },
  '#/server/admin-auth.server': { currentAdminPrincipal: async () => principal },
  '#/lib/private-mqtt': client,
}).Route
const get = () => route.server.handlers.GET({ request: new Request('https://example.com/api/mqtt/connection') })
let result = await get()
assert.equal(result.status, 401)
assert.equal(result.headers.get('cache-control'), 'no-store')
principal = { userKey: 'test', role: 'admin' }
result = await get()
assert.equal(result.status, 503)
env.MQTT_USERNAME = 'fixture-user'
env.MQTT_PASSWORD = 'fixture-password'
env.EMQX_APP_SECRET = 'must-never-be-returned'
result = await get()
assert.equal(result.status, 200)
assert.deepEqual(await result.json(), { url: client.PRIVATE_MQTT_URL, username: 'fixture-user', password: 'fixture-password' })
principal = null
result = await get()
assert.equal(result.status, 401)
assert.equal((await result.text()).includes('fixture-password'), false)
console.log('PASS: migration, credential destination validation, malformed responses, authentication, no-store, management secret isolation')
