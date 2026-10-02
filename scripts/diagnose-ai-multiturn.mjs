import assert from 'node:assert/strict'
import { ChatClient, fetchServerSentEvents } from '@tanstack/ai-client'
import { toServerSentEventsResponse } from '@tanstack/ai'

// Diagnostic replay only. No provider or game connections are made.
const originalFetch = globalThis.fetch
const requests = [], errors = []
let mode = 'healthy'
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  requests.push(body)
  const { threadId, runId } = body
  const messageId = `reply-${requests.length}`
  const events = [{ type: 'RUN_STARTED', threadId, runId }]
  if (mode === 'interrupted-tool') {
    events.push(
      { type: 'TOOL_CALL_START', toolCallId: 'unfinished', toolCallName: 'send_private_chat' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'unfinished', delta: '{"content":"partial' },
      { type: 'RUN_ERROR', error: { code: '502', message: 'fixture interrupted stream' } },
    )
  } else {
    events.push(
      { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: mode === 'literal-tool'
        ? 'function<|tool_sep|>send_private_chat\n{"content":"fixture only"}' : 'fixture reply' },
      { type: 'TEXT_MESSAGE_END', messageId },
      { type: 'RUN_FINISHED', threadId, runId },
    )
  }
  return toServerSentEventsResponse((async function* () {
    for (const event of events) yield { ...event, timestamp: Date.now() }
  })())
}
const client = new ChatClient({ threadId: 'diagnostic', connection: fetchServerSentEvents('https://fixture/api/ai/chat'),
  onError: error => errors.push(error.message) })
try {
  for (let i = 0; i < 30; i++) await client.sendMessage(`fixture turn ${i + 1}`)
  assert.equal(errors.length, 0)
  assert.equal(requests[0].messages.length, 1)
  assert.equal(requests[29].messages.length, 59)
  console.log('CONFIRMED: 30 healthy turns succeed; request history grows from 1 to 59 messages, with no automatic window.')
  mode = 'literal-tool'
  await client.sendMessage('fixture malformed output')
  mode = 'healthy'
  await client.sendMessage('fixture follow-up')
  assert.ok(requests.at(-1).messages.some(message => message.content?.includes?.('<|tool_sep|>')))
  console.log('CONFIRMED: tool markup emitted as text remains ordinary assistant text and is resent on the next turn.')
  mode = 'interrupted-tool'
  await client.sendMessage('fixture interrupted tool')
  mode = 'healthy'
  await client.sendMessage('fixture retry')
  const retry = requests.at(-1).messages
  const dangling = retry.flatMap(message => message.toolCalls ?? []).filter(call =>
    !retry.some(message => message.role === 'tool' && message.toolCallId === call.id))
  assert.ok(dangling.some(call => call.id === 'unfinished'))
  console.log('CONFIRMED: retry retains an incomplete tool call without a matching tool result. Strict providers can reject this history.')
  console.log(JSON.stringify({ requests: requests.length, finalHistoryMessages: retry.length,
    unmatchedToolCalls: dangling.length, reportedErrors: errors }, null, 2))
} finally {
  client.dispose()
  globalThis.fetch = originalFetch
}
