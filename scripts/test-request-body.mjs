import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function load(path, dependencies = {}) {
  const exports = {}
  runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, TextDecoder, Response, require: name => {
    assert.ok(name in dependencies, name); return dependencies[name]
  } })
  return exports
}
const reader = load('src/server/request-body.server.ts')
const encoder = new TextEncoder()
function streamed(chunks, { cancel = () => {}, error } = {}) {
  let index = 0
  const body = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++])
      else if (error) controller.error(error)
      else controller.close()
    }, cancel,
  }, { highWaterMark: 0 })
  return new Request('https://test/upload', { method: 'POST', body, duplex: 'half' })
}
test('counts bytes and preserves split UTF-8 at the exact boundary', async () => {
  const bytes = encoder.encode('甲🙂乙')
  const request = streamed([...bytes].map(byte => Uint8Array.of(byte)))
  assert.equal(await reader.readLimitedBody(request, bytes.length), '甲🙂乙')
  assert.equal(request.body.locked, false)
  assert.equal(await reader.readLimitedBody(new Request('https://test'), 10), '')
})
test('stops at first excessive chunk even without length; cancellation failure is contained', async () => {
  let cancelled = 0
  const request = streamed([encoder.encode('甲'), encoder.encode('乙'), encoder.encode('never read')], {
    cancel() { cancelled++; throw new Error('cancel failed') },
  })
  assert.equal(await reader.readLimitedBody(request, 5), null)
  assert.equal(cancelled, 1)
  assert.equal(request.body.locked, false)
})
test('read errors release stream lock', async () => {
  const request = streamed([], { error: new Error('disconnected') })
  await assert.rejects(reader.readLimitedBody(request, 10), /disconnected/)
  assert.equal(request.body.locked, false)
})

for (const [path, method, limit] of [
  ['src/routes/api/characters/upload.ts', 'POST', 1_000_000],
  ['src/routes/api/ai/persona.ts', 'PUT', 32 * 1024],
]) test(`${path}: rejects excess/read failures before database writes; accepts normal JSON`, async () => {
  let writes = 0, authorized = true
  const handler = load(path, {
    '@tanstack/react-router': { createFileRoute: () => options => options },
    '#/server/request-body.server': reader,
    '#/server/admin-auth.server': { currentAdminPrincipal: async () => authorized ? { role: 'admin' } : null },
    '#/server/api-auth.server': { verifyBearerToken: async () => false,
      jsonError: (error, status) => Response.json({ error }, { status }) },
    '#/lib/character-upload': { parseCharacterUpload: value => ({ ok: true, value }) },
    '#/server/characters.server': { uploadToken: () => '', upsertCharacters: async rows => { writes++; return rows.length } },
    '#/server/ai-persona.server': { saveAiPersona: async (_, persona) => { writes++; return { ok: true, persona } } },
  }).Route.server.handlers[method]
  let cancelled = false
  const large = streamed([encoder.encode('甲'.repeat(Math.ceil(limit / 3) + 1))], { cancel() { cancelled = true } })
  assert.equal((await handler({ request: large })).status, 413)
  assert.equal(cancelled, true)
  assert.equal((await handler({ request: streamed([], { error: new Error('disconnect') }) })).status, 400)
  assert.equal((await handler({ request: streamed([encoder.encode('{')]) })).status, 400)
  assert.equal(writes, 0)
  authorized = false
  const untouched = streamed([encoder.encode('{}')])
  assert.equal((await handler({ request: untouched })).status, 401)
  assert.equal(untouched.bodyUsed, false)
  authorized = true
  const json = method === 'POST' ? '[{"characterName":"甲"}]' : '{"name":"甲"}'
  assert.equal((await handler({ request: streamed([encoder.encode(json)]) })).status, 200)
  assert.equal(writes, 1)
})
