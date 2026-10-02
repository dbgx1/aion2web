import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/lib/managed-chat.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const { ManagedChatRunner } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const roles = [{ characterId: '1', serverKey: '1001', name: 'Fixture' }]
const config = { agentId: 'A1', serverId: '1001', room: 'fixture', scope: 'all', intervalMs: 0, proactiveMs: 180000 }
let now = 1000000, rejectSend, mode = 'pending', turns = 0
const sends = []
const runner = new ManagedChatRunner({ now: () => now, changed: () => {}, guard: () => null, verify: async () => {},
  send: async (_config, _role, text) => {
    sends.push(text)
    if (mode === 'pending') await new Promise((_resolve, reject) => { rejectSend = reject })
  },
  run: async turn => {
    turns++
    if (mode === 'group') {
      assert.throws(() => turn.queueGroup('   ', [' ', '\n']), /空群发/)
      assert.equal(turn.queueGroup('valid', [' valid ']), 1, 'Invalid broadcast must not consume the queue allowance')
    } else await turn.send(mode === 'pending' ? 'old task text' : 'new task text')
  },
})

// An old transport can reject after a new task has already loaded the same role.
await runner.start(config, async () => roles)
now += 5000
const oldTurn = runner.tick()
await new Promise(resolve => setImmediate(resolve))
assert.equal(typeof rejectSend, 'function')
await runner.start({ ...config, serverId: '1001' }, async () => roles)
rejectSend(new Error('late receipt failure'))
await oldTurn
mode = 'normal'; now += 5000
await runner.tick()
assert.deepEqual(sends, ['old task text', 'new task text'], 'Stopped task must not inject its draft into the replacement task')
assert.equal(turns, 2)

// Pause/resume is still the SAME task and retains the existing exact-text retry policy.
mode = 'pending'; sends.length = 0
await runner.start(config, async () => roles); now += 5000
const pausedTurn = runner.tick()
await new Promise(resolve => setImmediate(resolve))
runner.pause(); rejectSend(new Error('uncertain receipt')); await pausedTurn
mode = 'normal'; runner.resume(); now += 5000
await runner.tick()
assert.deepEqual(sends, ['old task text', 'old task text'])

mode = 'group'; sends.length = 0
await runner.start(config, async () => roles); now += 5000
await runner.tick(); await runner.tick()
assert.deepEqual(sends, ['valid'])
runner.stop()
console.log('PASS: stopped task isolation, paused exact-text retry, blank broadcast rejection and valid queue recovery')
