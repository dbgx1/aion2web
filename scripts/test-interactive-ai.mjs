import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { ChatClient, clientTools } from '@tanstack/ai-client'
import { toServerSentEventsResponse, toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

async function moduleAt(path) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'esm' })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}
const history = await moduleAt('src/lib/ai-history.ts')
const { interactiveAiConnection } = await moduleAt('src/lib/interactive-ai-connection.ts')
const user = content => ({ role: 'user', content })
const call = (id, args = '{"content":"fixture"}') => ({ id, type: 'function', function: { name: 'send_private_chat', arguments: args } })
const assistant = (...calls) => ({ role: 'assistant', content: null, toolCalls: calls })
const result = (id, content = '{"sent":true}') => ({ role: 'tool', toolCallId: id, content })
function paired(messages) {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const results = messages.slice(i + 1, i + 1 + m.toolCalls.length)
      assert.deepEqual(results.map(r => r.toolCallId), m.toolCalls.map(c => c.id))
      assert.ok(results.every(r => r.role === 'tool'))
      for (const c of m.toolCalls) assert.doesNotThrow(() => JSON.parse(c.function.arguments))
      i += m.toolCalls.length
    } else assert.notEqual(m.role, 'tool', 'No orphan tool result')
  }
}
const seed = [user('one'), assistant(call('a'), call('b')), result('b', '{"sent":false}'), result('a'), user('two')]
const original = structuredClone(seed)
let prepared = history.prepareAiHistory(seed)
paired(prepared.messages)
assert.deepEqual(seed, original, 'History evidence must not be mutated')
assert.equal(prepared.messages[2].content, '{"sent":true}')
assert.deepEqual(history.prepareAiHistory(prepared.messages).messages, prepared.messages, 'Projection is idempotent')
prepared = history.prepareAiHistory([user('one'), assistant(call('a'), call('b', '{')), result('a'), user('next')])
paired(prepared.messages)
assert.ok(prepared.messages.some(m => m.content === '{"sent":true}'))
assert.equal(prepared.repairedCalls, 1)
prepared = history.prepareAiHistory([user('one'), assistant(call('bad', '{')), result('bad'), user('next')])
paired(prepared.messages)
assert.ok(JSON.stringify(prepared.messages).includes('sent'), 'Corrupt arguments must not erase an already recorded result')
prepared = history.prepareAiHistory([user('one'), {role:'assistant',content:[{type:'text',content:'function<|tool_'},{type:'text',content:'sep|>send_private_chat'}]}, user('next')])
assert.equal(prepared.malformedTexts, 1)
assert.ok(!JSON.stringify(prepared.messages).includes('tool_sep'))
prepared = history.prepareAiHistory([user('one'), assistant(call('a')), user('next'), result('a')])
paired(prepared.messages)
assert.equal(JSON.parse(prepared.messages[2].content).status, 'unknown', 'A result from another turn cannot prove delivery')
assert.equal(prepared.orphanResults, 1)
prepared = history.prepareAiHistory(Array.from({ length: 100 }, (_, i) => [user('turn ' + i), assistant(call('c' + i)), result('c' + i)]).flat())
assert.equal(prepared.messages.filter(m => m.role === 'user').length, 12)
assert.equal(prepared.messages[0].content, 'turn 88')
paired(prepared.messages)
assert.throws(() => history.prepareAiHistory([user('大'.repeat(30_000))]), /内容过长/)
assert.equal(history.prepareAiHistory([user('大'.repeat(30_000)), user('recover')]).messages.length, 1)
assert.equal(history.trimAiUiHistory([{ id: 'old', role: 'user', parts: [{ type: 'text', content: '大'.repeat(70_000) }] }], 'recover').length, 0)
console.log('PASS: complete-turn bounds, byte bounds, tool pairing, truthful uncertainty, immutable evidence, idempotence, oversized-turn recovery')

const originalFetch = globalThis.fetch
let mode = 'healthy', requests = [], sends = 0, errors = []
const send = toolDefinition({ name: 'send_private_chat', description: 'test only', inputSchema: z.object({ content: z.string() }) }).client(() => { sends++; return { sent: true } })
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  requests.push(body)
  paired(body.messages)
  const { threadId, runId } = body, id = 'm' + requests.length
  if (mode === 'stall') {
    return new Response(new ReadableStream({ start(controller) {
      init.signal.addEventListener('abort', () => controller.error(new DOMException('cancelled', 'AbortError')), { once: true })
    } }), { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const events = [{ type: 'RUN_STARTED', threadId, runId }]
  if (mode === 'partial') events.push(
    { type: 'TOOL_CALL_START', toolCallId: 'partial', toolCallName: 'send_private_chat' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'partial', delta: '{"content":"unfinished' },
    { type: 'RUN_ERROR', error: { code: '502', message: 'fixture failure' } },
  )
  else if (mode === 'send' && body.messages.at(-1).role !== 'tool') {
    const input = { content: 'fixture' }, toolCallId = 'action' + requests.length
    events.push({ type: 'TOOL_CALL_START', toolCallId, toolCallName: 'send_private_chat' },
      { type: 'TOOL_CALL_END', toolCallId, input },
      { type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'interrupt', interrupts: [{ id: 'client_tool_' + toolCallId,
        reason: 'tanstack:client_tool_execution', toolCallId, responseSchema: {}, metadata: { kind: 'client_tool', toolName: 'send_private_chat', input } }] } })
  } else {
    events.push({ type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' })
    const chunks = mode === 'malformed' ? ['function<|tool_', 'sep|>send_private_chat'] : ['fixture reply']
    for (const delta of chunks) events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta })
    if (mode !== 'truncated') events.push({ type: 'TEXT_MESSAGE_END', messageId: id }, { type: 'RUN_FINISHED', threadId, runId })
  }
  return toServerSentEventsResponse((async function* () { for (const event of events) yield { ...event, timestamp: Date.now() } })())
}
const client = new ChatClient({ threadId: 'test-interactive', connection: interactiveAiConnection({ timeoutMs: 100 }), tools: clientTools(send),
  onError: error => errors.push({ code: error.code, message: error.message }) })
try {
  for (let i = 0; i < 100; i++) {
    mode = i % 10 === 0 ? 'send' : 'healthy'
    await client.sendMessage('fixture turn ' + i)
  }
  assert.equal(errors.length, 0)
  assert.equal(sends, 10, 'Each requested action executes once across 100 turns')
  assert.ok(requests.every(r => r.messages.filter(m => m.role === 'user').length <= 12))
  assert.ok(requests.every(r => Buffer.byteLength(JSON.stringify(r.messages)) < 64_000))
  for (const failure of ['partial', 'malformed', 'truncated', 'stall']) {
    const before = requests.length, beforeErrors = errors.length
    mode = failure
    await client.sendMessage('fixture error ' + failure)
    assert.equal(requests.length, before + 1, 'No automatic retry: ' + failure)
    assert.equal(errors.length, beforeErrors + 1, 'Failure is reported: ' + failure)
    mode = 'healthy'
    await client.sendMessage('fixture recover ' + failure)
    assert.equal(errors.length, beforeErrors + 1, 'New turn recovers: ' + failure + ' ' + JSON.stringify(errors))
    assert.equal(sends, 10, 'Recovery cannot rerun old game actions')
  }
  assert.deepEqual(errors.slice(1).map(e => e.code), ['AI_TOOL_FORMAT', 'AI_STREAM_INCOMPLETE', 'AI_STREAM_TIMEOUT'])
  console.log('PASS: real SDK + SSE: 100 turns, 10 actions exactly once, bounded history, interrupted tool recovery, split marker detection, missing terminal detection, body timeout, no automatic replay')
} finally { client.dispose(); globalThis.fetch = originalFetch }
