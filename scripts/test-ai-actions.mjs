import assert from 'node:assert/strict'
import { build } from 'esbuild'

async function load(path) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'esm' })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}
const { CommandReceipts } = await load('src/lib/command-receipts.ts')
const { AiInteraction } = await load('src/lib/ai-interaction.ts')
const receipts = new CommandReceipts()
let id, publishes = 0
const publish = requestId => { id = requestId; publishes++; return true }
const first = receipts.send('A', publish)
for (const [agent, receipt, retained] of [
  ['B', {type:'control_result',requestId:id,ok:true}],
  ['A', {type:'control_result',requestId:id,agentId:'B',ok:true}],
  ['A', {type:'control_result',requestId:id,ok:true}, true],
  ['A', {type:'control_ack',requestId:id,ok:true}],
  ['A', {type:'control_result',requestId:'old',ok:true}],
  ['A', {type:'control_result',requestId:id,ok:'true'}],
]) receipts.accept(agent, receipt, retained)
assert.equal(receipts.size, 1, 'Wrong, retained, and acknowledgement events cannot confirm execution')
receipts.accept('A', {type:'control_result',requestId:id,ok:true})
assert.equal((await first).status, 'confirmed')
assert.equal(receipts.size, 0)
const failed = receipts.send('A', publish)
receipts.accept('A', {type:'control_result',requestId:id,ok:false})
assert.equal((await failed).status, 'failed')
assert.equal((await receipts.send('A', () => false)).status, 'not_sent')
assert.equal((await receipts.send('A', () => { throw Error('connection lost') })).status, 'unknown')
assert.equal((await receipts.send('A', publish, undefined, 5)).status, 'unknown')
const controller = new AbortController()
const cancelled = receipts.send('A', publish, controller.signal)
const oldId = id
controller.abort()
assert.equal((await cancelled).status, 'unknown')
const count = publishes
assert.equal((await receipts.send('A', publish, controller.signal)).status, 'not_sent')
assert.equal(publishes, count, 'Already cancelled request never publishes')
const pending = receipts.send('A', publish)
receipts.accept('A', {type:'control_result',requestId:oldId,ok:true})
assert.equal(receipts.size, 1, 'Late receipt cannot complete a new request')
receipts.disconnect()
assert.equal((await pending).status, 'unknown')
assert.equal(receipts.size, 0)
const synchronous = receipts.send('A', requestId => {
  receipts.accept('A', {type:'control_result',requestId,ok:true}); return true
})
assert.equal((await synchronous).status, 'confirmed')

const interaction = new AiInteraction()
const run = interaction.begin()
interaction.registerTool('one', 'send')
assert.equal(interaction.requireTool('one', 'send'), run)
assert.throws(() => interaction.requireTool('one', 'different'))
let actions = 0, resolve
const action = () => { actions++; return new Promise(r => { resolve = r }) }
const a = run.once('same content', action), b = run.once('same content', action)
await Promise.resolve()
assert.equal(actions, 1)
assert.equal(a, b, 'Duplicate calls share the same in-flight outcome')
interaction.stop()
const next = interaction.begin()
resolve('late result')
assert.equal(await a, 'late result')
interaction.finish(run)
assert.ok(interaction.isCurrent(next), 'Old completion must not stop the replacement run')
assert.throws(() => interaction.requireTool('one', 'send'))
assert.throws(() => run.once('new action', action))
let failures = 0
const failure = () => { failures++; throw Error('uncertain delivery') }
await assert.rejects(next.once('failed action', failure))
await assert.rejects(next.once('failed action', failure))
assert.equal(failures, 1, 'Failure must not automatically replay the side effect')
for (let i=0; i<8; i++) interaction.beforeRequest()
assert.throws(() => interaction.beforeRequest(), /步骤过多/)
interaction.finish(next)
assert.equal(interaction.active, false)
console.log('PASS: execution receipt correlation, timeout/disconnect/cancellation, late outcomes, action deduplication and continuation budget')
