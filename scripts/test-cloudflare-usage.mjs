import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function load(path, dependencies = {}, globals = {}) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, { exports, Error, Date, AbortSignal, Response, ...globals, require: name => { assert.ok(name in dependencies, name); return dependencies[name] } })
  return exports
}
const lib = load('../src/lib/cloudflare-usage.ts')
assert.equal(lib.usageDates(new Date('2026-09-05T07:59:59+08:00')).at(-1), '2026-09-04')
assert.equal(lib.usageDates(new Date('2026-09-05T08:00:00+08:00')).at(-1), '2026-09-05')
assert.equal(lib.quotaState(null, 100).percent, null)
assert.equal(lib.quotaState(0, 100).level, 'normal')
assert.equal(lib.quotaState(80, 100).level, 'warning')
assert.equal(lib.quotaState(150, 100).percent, 150)
assert.equal(lib.quotaState(150, 100).remaining, 0)

const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_USAGE_API_TOKEN: 'test-secret' }
const config = { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_USAGE_API_TOKEN }
const now = new Date('2026-09-04T23:45:00Z')
let requests = 0, mode = 'success'
const service = load('../src/server/cloudflare-usage.server.ts', { 'cloudflare:workers': { env }, '#/lib/cloudflare-usage': lib }, {
  fetch: async (url, options) => {
    requests++
    assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql')
    const { query } = JSON.parse(options.body)
    const dataset = query.includes('workersInvocationsAdaptive') ? 'workersInvocationsAdaptive' : query.includes('d1AnalyticsAdaptiveGroups') ? 'd1AnalyticsAdaptiveGroups' : 'd1StorageAdaptiveGroups'
    if (mode === '429') return new Response('', { status: 429 })
    if (mode === 'empty-account') return Response.json({ data: { viewer: { accounts: [] } } })
    if (mode === 'empty-data') return Response.json({ data: { viewer: { accounts: [{ [dataset]: [] }] } } })
    if (mode === 'partial' && dataset === 'workersInvocationsAdaptive') return Response.json({ errors: [{ message: 'permission denied test-secret' }], data: null })
    const row = dataset === 'workersInvocationsAdaptive'
      ? { dimensions: { date: '2026-09-04' }, sum: { requests: 120000 } }
      : dataset === 'd1AnalyticsAdaptiveGroups'
        ? { dimensions: { date: '2026-09-04' }, sum: { rowsRead: 19000000, rowsWritten: mode === 'invalid' ? null : 1100000 } }
        : { dimensions: { databaseId: 'db-1' }, max: { databaseSizeBytes: 500000000 } }
    return Response.json({ data: { viewer: { accounts: [{ [dataset]: [row] }] } }, errors: null })
  },
})
let data = await service.collectCloudflareUsage(config, now)
assert.equal(data.days.length, 7)
assert.equal(data.days.at(-1).rowsRead, 19000000)
assert.equal(data.days[0].requests, 0)
assert.equal(data.storageBytes, 500000000)
assert.equal(data.errors.length, 0)
assert.ok(!JSON.stringify(data).includes('test-secret'))
mode = 'partial'
data = await service.collectCloudflareUsage(config, now)
assert.equal(data.days.at(-1).requests, null)
assert.equal(data.days.at(-1).rowsWritten, 1100000)
assert.equal(data.errors.length, 1)
assert.ok(!JSON.stringify(data).includes('test-secret'))
mode = 'invalid'
data = await service.collectCloudflareUsage(config, now)
assert.equal(data.days.at(-1).rowsRead, null, 'malformed dataset must not publish partial numbers')
mode = 'empty-data'
data = await service.collectCloudflareUsage(config, now)
assert.equal(data.days.at(-1).requests, 0)
assert.equal(data.storageBytes, null, 'no storage reports is not proof of zero storage')
mode = 'empty-account'
data = await service.collectCloudflareUsage(config, now)
assert.equal(data.days.at(-1).requests, null)
mode = '429'
data = await service.collectCloudflareUsage(config, now)
assert.equal(data.errors.length, 3)
assert.equal(data.days.at(-1).rowsRead, null)
// Cache failures too, preventing repeated refreshes from hammering a rate-limited API.
requests = 0
await service.getCloudflareUsage()
await service.getCloudflareUsage()
assert.equal(requests, 3)
env.CLOUDFLARE_USAGE_API_TOKEN = ''
assert.equal((await service.getCloudflareUsage()).configured, false)
assert.equal(requests, 3, 'unconfigured requests make no Cloudflare calls')

let principal = null, reads = 0
const route = load('../src/routes/api/admin/cloudflare-usage.ts', {
  '@tanstack/react-router': { createFileRoute: () => value => value },
  '#/server/admin-auth.server': { currentAdminPrincipal: async () => principal },
  '#/server/cloudflare-usage.server': { getCloudflareUsage: async () => { reads++; return data } },
})
const request = new Request('https://example.test/api/admin/cloudflare-usage')
const get = () => route.Route.server.handlers.GET({ request })
assert.equal((await get()).status, 401)
principal = { role: 'agent' }
assert.equal((await get()).status, 403)
assert.equal(reads, 0)
principal = { role: 'admin' }
const response = await get()
assert.equal(response.status, 200)
assert.equal(response.headers.get('Cache-Control'), 'no-store')
assert.equal((await response.json()).days.length, 7)
console.log('PASS: UTC reset, quota thresholds, actual serialized API, admin authorization, partial failures, missing data, no token leakage, cache/backoff, no calls before setup')
