import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import mqtt from 'mqtt'

const require = createRequire(import.meta.url)
const broker = require(join(tmpdir(), 'aion2web-load-runtime/node_modules/aedes'))()
const tcp = createServer(broker.handle)
await new Promise(r => tcp.listen(0, '127.0.0.1', r))
const reserve = createServer()
await new Promise(r => reserve.listen(0, '127.0.0.1', r))
const webPort = reserve.address().port
await new Promise(r => reserve.close(r))
const scratch = mkdtempSync(join(tmpdir(), 'aion2-package-smoke-'))
const config = join(scratch, 'config'), storage = join(scratch, 'storage')
mkdirSync(config); mkdirSync(storage)
writeFileSync(join(config, 'config.yaml'), 'web_open_browser: false\n')
const exe = resolve(process.argv[2] || 'artifacts/client-release/aion2-client/aion2-client.exe')
const client = await mqtt.connectAsync('mqtt://127.0.0.1:' + tcp.address().port, { reconnectPeriod: 0 })
await client.subscribeAsync('package-smoke/isolated/#')
const messages = []
client.on('message', (topic, data) => { try { messages.push({ topic, value: JSON.parse(data.toString()) }) } catch {} })
const env = { ...process.env, AION2_AUTO_INSTALL_CERT: '0', AION2_PAUSE_ON_ERROR: '0',
  AION2_MITM_CONFDIR: config, AION2_RELAY_DATA_DIR: storage,
  AION2_MITM_MODE: 'regular', AION2_MITM_TOOL: 'mitmweb', AION2_MITM_HOST: '127.0.0.1', AION2_MITM_PORT: '0',
  AION2_WEB_HOST: '127.0.0.1', AION2_WEB_PORT: String(webPort), AION2_WEB_OPEN_BROWSER: '0',
  AION2_MQTT_HOST: '127.0.0.1', AION2_MQTT_PORT: String(tcp.address().port),
  AION2_SIGNAL_PREFIX: 'package-smoke', AION2_RELAY_ROOM: 'isolated', AION2_AGENT_ID: 'package-test' }
delete env.PYTHONHOME; delete env.PYTHONPATH
let child, logs = ''
const report = { at: new Date().toISOString(), exe, testMode: 'real frozen mitmweb, loopback broker, expired command only; no game traffic or trusted certificate installation' }
let builtInAuthenticated = false
if (process.env.REQUIRE_BUILTIN_MQTT === '1') {
  const expected = JSON.parse(readFileSync('artifacts/client-release/private-mqtt-20260912/aion2-client/mqtt.private.local.json', 'utf8').replace(/^\uFEFF/, ''))
  delete env.AION2_MQTT_USERNAME; delete env.AION2_MQTT_PASSWORD
  env.AION2_MQTT_CONFIG = join(scratch, 'no-config.json')
  broker.authenticate = (_peer, username, password, callback) => {
    const valid = username === expected.username && password?.toString() === expected.password
    builtInAuthenticated ||= valid
    callback(null, valid)
  }
}
async function waitFor(fn, timeout = 30000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (fn()) return
    if (child?.exitCode !== null) throw new Error('Packaged client exited: ' + child.exitCode)
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('Timed out waiting for packaged client')
}
try {
  child = spawn(exe, [], { cwd: scratch, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', b => { logs += b.toString() })
  child.stderr.on('data', b => { logs += b.toString() })
  await waitFor(() => messages.some(m => m.value.type === 'agent_status' && m.value.status === 'online'))
  report.build = messages.find(m => m.value.status === 'online').value.build
  if (process.env.REQUIRE_BUILTIN_MQTT === '1') {
    assert.equal(builtInAuthenticated, true)
    report.builtInCredentialsVerified = true
  }
  if (process.env.REQUIRE_CHARACTER_NAME === '1') {
    assert.ok(messages.some(m => m.value.type === 'agent_status' && Object.hasOwn(m.value, 'characterName')), 'Packaged heartbeat must include characterName')
    report.characterNameHeartbeat = true
  }
  assert.equal(report.build, process.env.EXPECTED_CLIENT_BUILD || '2026-09-10.reliable-mqtt')
  const page = await fetch('http://127.0.0.1:' + webPort, { signal: AbortSignal.timeout(10000) })
  const html = await page.text()
  assert.equal(page.status, 200)
  const asset = html.match(/<script[^>]+src="([^"]+)"/)?.[1]
  assert.ok(asset, 'mitmweb must include its UI assets')
  const uiAsset = await fetch(new URL(asset, 'http://127.0.0.1:' + webPort), { signal: AbortSignal.timeout(10000) })
  assert.equal(uiAsset.status, 200)
  report.mitmweb = { pageStatus: page.status, assetStatus: uiAsset.status }
  const command = { type: 'sendWhisper', target: 'package-test', requestId: 'expired-package-test', characterId: 'fixture', content: 'must not execute', expiresAt: 1 }
  const results = () => messages.filter(m => m.value.type === 'control_result' && m.value.requestId === command.requestId)
  await client.publishAsync('package-smoke/isolated/control/agent/package-test', JSON.stringify(command))
  await waitFor(() => results().length >= 1)
  await client.publishAsync('package-smoke/isolated/control/agent/package-test', JSON.stringify(command))
  await waitFor(() => results().length >= 2)
  assert.ok(results().every(m => m.value.status === 'not_sent' && m.value.ok === false))
  if (process.env.REQUIRE_RECEIPT_TOPICS === '1') {
    assert.ok(results().every(m => m.topic === 'package-smoke/isolated/events/package-test/receipts'))
    assert.ok(messages.filter(m => m.value.type === 'control_ack').every(m => m.topic.endsWith('/receipts')))
    assert.equal(messages.filter(m => m.topic.endsWith('/chat') && ['control_ack', 'control_result'].includes(m.value.type)).length, 0)
    report.receiptTopicSeparation = true
  }
  const dbPath = join(storage, readdirSync(storage).find(n => n.endsWith('.sqlite3')))
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM commands').get().count, 1)
    await waitFor(() => db.prepare('SELECT COUNT(*) AS count FROM events').get().count === 0)
  } finally { db.close() }
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
  report.addonMatchesSource = hash(join(exe, '../_internal/mitm_ws_message_monitor.py')) === hash('E:/project/aion2/client/mitm_ws_message_monitor.py')
  assert.equal(report.addonMatchesSource, true)
  report.expiredCommandResults = results().map(m => m.value.status)
  report.persistedCommandCount = 1
  report.pendingEvents = 0
  report.passed = true
} catch (error) {
  report.passed = false; report.error = String(error); process.exitCode = 1
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise(r => child.once('exit', r))
    child.kill()
    await Promise.race([exited, new Promise(r => setTimeout(r, 5000))])
  }
  await client.endAsync(true)
  await new Promise(r => broker.close(r))
  await new Promise(r => tcp.close(r))
  const reportPrefix = process.env.CLIENT_PACKAGE_REPORT_PREFIX || 'artifacts/client-package-smoke'
  writeFileSync(reportPrefix + '.log', logs)
  writeFileSync(reportPrefix + '.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
