import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { toServerSentEventsResponse } from '@tanstack/ai'

const bundle = await build({ entryPoints: ['src/lib/managed-ai-turn.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const { runManagedAiTurn } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const originalFetch = globalThis.fetch, originalInfo = console.info
let mode, requests, sends, groups, logs, controller
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body); requests.push(body)
  const { threadId, runId } = body
  const events = [{ type: 'RUN_STARTED', threadId, runId }]
  const tool = mode === 'group' ? 'send_group_chat' : 'send_private_chat'
  if (mode === 'provider-error') events.push({ type: 'RUN_ERROR', error: { message: 'upstream limited', code: '429' } })
  else if (['send-failure', 'send', 'group', 'cancel-send'].includes(mode) || (mode === 'recover' && requests.length === 2)) {
    const input = { content: 'fixture-only' }, toolCallId = 'call-' + requests.length
    events.push({ type: 'TOOL_CALL_START', toolCallId, toolCallName: tool }, { type: 'TOOL_CALL_END', toolCallId, input },
      { type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'interrupt', interrupts: [{ id: 'client_tool_' + toolCallId,
        reason: 'tanstack:client_tool_execution', toolCallId, responseSchema: {}, metadata: { kind: 'client_tool', toolName: tool, input } }] } })
  } else events.push({ type: 'TEXT_MESSAGE_START', messageId: 'text', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'text', delta: 'fixture text, never send this directly' },
    { type: 'TEXT_MESSAGE_END', messageId: 'text' }, { type: 'RUN_FINISHED', threadId, runId })
  return toServerSentEventsResponse((async function* () { for (const event of events) yield { ...event, timestamp: Date.now() } })())
}
console.info = (...args) => logs.push(args)
async function execute(scenario) {
  originalInfo('Checking:', scenario)
  mode = scenario; requests = []; sends = []; groups = []; logs = []; controller = new AbortController()
  return runManagedAiTurn({ recipient: { characterId: 'one', serverKey: '1001', name: 'Fixture' },
    config: { agentId: 'A1', acquiredAt: 100, scope: 'single', instruction: 'fixture' }, reason: 'reply', signal: controller.signal, history: [],
    send: async content => { sends.push(content); if (mode === 'send-failure') throw new Error('receipt failed'); if (mode === 'cancel-send') { controller.abort(); controller.signal.throwIfAborted() } return true },
    queueGroup: content => { groups.push(content); return 3 },
  }, { history: async () => [], presence: async () => 'online', controlDraft: () => {}, notice: () => { if (mode === 'cancel-recovery') controller.abort() } })
}
try {
  await execute('recover')
  assert.equal(requests.length, 2); assert.equal(requests[1].forwardedProps.requireChatAction, true)
  assert.deepEqual(sends, ['fixture-only']); assert.equal(groups.length, 0)
  assert.equal(requests[1].forwardedProps.selectedCharacter.characterId, 'one')
  assert.ok(!JSON.stringify(logs).includes('fixture-only')); assert.ok(!JSON.stringify(logs).includes('Fixture'))
  await assert.rejects(execute('no-action'), /已纠正一次/)
  assert.equal(requests.length, 2); assert.equal(sends.length, 0)
  await assert.rejects(execute('provider-error'), /upstream limited/)
  assert.equal(requests.length, 1)
  await assert.rejects(execute('send-failure'), /receipt failed/)
  assert.equal(requests.length, 1); assert.equal(sends.length, 1)
  await execute('send'); assert.equal(requests.length, 1); assert.equal(sends.length, 1)
  await execute('group'); assert.equal(requests.length, 1); assert.equal(groups.length, 1)
  await assert.rejects(execute('cancel-send')); assert.equal(requests.length, 1)
  await assert.rejects(execute('cancel-recovery')); assert.equal(requests.length, 1); assert.equal(sends.length, 0)
} finally { globalThis.fetch = originalFetch; console.info = originalInfo }
console.log('PASS: real ChatClient + SSE: bounded no-action recovery, fixed scope, no raw-text sends, provider/receipt failure preservation, cancellation, no post-action model calls, content-free diagnostics')
