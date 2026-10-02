import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'

const exports = {}
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/console-subscriptions.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports, Set })
const { ConsoleSubscriptions, validAgentId } = exports
const active = new Set(), callbacks = [], errors = []
const client = {
  subscribe(topics, options, cb) { topics.forEach(topic => active.add(topic)); callbacks.push((error, grants = topics.map(topic => ({ topic, qos: 1 }))) => cb(error, grants)) },
  unsubscribe(topics) { topics.forEach(topic => active.delete(topic)) },
}
const scope = new ConsoleSubscriptions()
const update = id => scope.update(client, 'room', id, message => errors.push(message))
update('')
assert.deepEqual([...active], ['room/agents/+/status'])
update('A')
assert.equal(scope.readyAgent, '')
callbacks.shift()(null, []) // Discovery SUBACK arrives after selection changed.
assert.equal(scope.readyAgent, '')
callbacks.shift()(null)
assert.equal(scope.readyAgent, 'A')
update('B')
assert.deepEqual([...active].sort(), ['room/agents/+/status', 'room/events/B/chat', 'room/events/B/receipts'])
callbacks.shift()(null, [{ qos: 128 }])
assert.equal(scope.readyAgent, '')
assert.equal(errors.length, 1)
update('B')
scope.reset()
callbacks.shift()(null, []) // A disconnected session cannot restore readiness.
assert.equal(scope.readyAgent, '')
active.clear()
update('B')
callbacks.shift()(null)
assert.equal(scope.readyAgent, 'B')
for (const grants of [[], undefined, [{ topic: 'room/agents/+/status', qos: 1 }],
  [{ topic: 'room/agents/+/status', qos: 1 }, { topic: 'room/events/B/chat', qos: 1 }, { topic: 'room/events/other/receipts', qos: 1 }]]) {
  scope.update({ ...client, subscribe(topics, options, callback) { callback(null, grants) } }, 'room', 'B', message => errors.push(message))
  assert.equal(scope.readyAgent, '', 'Missing or mismatched receipt subscription cannot enable sending')
}
update('')
assert.deepEqual([...active], ['room/agents/+/status'], 'Client list keeps receiving heartbeats after deselection')
for (const id of ['', '+', '#', 'A/chat', 'A\0B']) assert.equal(validAgentId(id), false)
console.log('PASS: exact subscriptions, switch/unsubscribe, stale SUBACK, incomplete/mismatched grants, rejection, reconnect and invalid IDs')
