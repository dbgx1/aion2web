import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const source = readFileSync(root + 'src/routes/index.tsx', 'utf8')
const fixture = `
import { createRoot } from 'react-dom/client'
window.calls = []
window.toUpload = message => chatUploadFromConsoleMessage(message, 'Role 1')
const query = (characters, receive, signal) => new Promise((resolve, reject) => {
  const call = { characters, signal, receive, resolve, reject }
  window.calls.push(call)
  signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
})
window.deliver = (index, status) => {
  const call = window.calls[index]
  call.receive({ type: 'presence_result', requestId: 'request-' + index,
    results: call.characters.map(character => ({ ...character, status, checkedAt: Date.now(), ...(status === 'unknown' ? {error:'区服 '+character.serverId+' 当前没有在线查询客户端，请先连接该区服的查询客户端后重试'} : {}) })) })
}
window.finish = (index, status) => { window.deliver(index, status); window.calls[index].resolve() }
function Fixture() {
  const [agent, setAgent] = useState({ agentId: 'test', serverId: '1001', host: 'Test' })
  const [selected, select] = useClientCharacter(agent.agentId, agent.serverId)
  window.selected = selected
  const [connected, setConnected] = useState(true), [mounted, setMounted] = useState(true)
  window.changeAgent = setAgent
  const [events, setEvents] = useState([])
  window.setEvents = setEvents
  window.setConnected = setConnected
  window.unmountChat = () => setMounted(false)
  return mounted && <MessageCenter key={JSON.stringify([agent.agentId, agent.serverId])} agent={agent}
    selectedCharacter={selected} onCharacterSelect={select} agentMessages={events} messages={events}
    readMessageIds={new Set()} onMessagesRead={()=>{}} content="" actionMessage="" onBack={()=>{}}
    onContentChange={()=>{}} onSend={()=>{}} onSendPrivateChat={async()=>({})} onSendAll={async()=>({})}
    onStopBulkSend={()=>{}} bulkSending={false} canOperate={true} onSendFaction={async()=>({})}
    bulkIntervalRangeMs={{ min: 1000, max: 1000 }} onBulkIntervalRangeChange={()=>{}}
    onQueryPresence={query} presenceConnected={connected} />
}
createRoot(document.getElementById('root')).render(<TrackingProvider><Fixture /></TrackingProvider>)
`
const bundle = await build({ stdin: { contents: source + fixture, loader: 'tsx', resolveDir: root + 'src/routes' },
  bundle: true, write: false, outdir: 'fixture', platform: 'browser', format: 'iife', jsx: 'automatic', loader:{'.md':'text'},
  alias: { '#': root + 'src' }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' }, logLevel: 'silent' })
const persisted = new Map(), saves = []
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); return }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(readFileSync(root + 'src/styles.css')); return }
  if (url.pathname.startsWith('/api/')) {
    let body = { ok: true, entries: [], servers: [], messages: [], statuses: [...persisted.values()], nextCursor: null, totalCount: 2,
      characters: [1, 2].map(id => ({ id, characterId: String(id), characterName: 'Role ' + id, serverId: url.searchParams.get('serverId') || '1001', serverName: 'Test', legionName: '', className: '剑星', level: 45 })) }
    if (url.pathname === '/api/presence/results') {
      let raw = ''; for await (const chunk of req) raw += chunk
      const envelope = JSON.parse(raw); saves.push(envelope)
      for (const result of envelope.results) persisted.set(result.characterId, { ...result, online: result.status === 'unknown' ? null : result.status === 'online', updatedAt: result.checkedAt, sourceId: 'test' })
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return
  }
  res.setHeader('Content-Type', 'text/html')
  res.end('<html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="padding:12px"><div id="root"></div><script src="/bundle.js"></script></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const count = () => page.evaluate(() => window.calls.length)
  const waitCount = value => page.waitForFunction(value => window.calls.length === value, value)
  const finish = async (index, status = 'online') => {
    await page.evaluate(({ index, status }) => window.finish(index, status), { index, status })
    await page.waitForFunction(() => /本轮完成|秒后重试/.test(document.querySelector('.conversation-presence small')?.textContent || ''))
  }
  const interval = page.getByLabel('当前角色在线查询间隔')
  await waitCount(1)
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  assert.equal(await interval.inputValue(), '60000')
  assert.deepEqual(await page.evaluate(() => window.calls[0].characters.map(role => role.characterId)), ['1'])
  assert.equal(await page.locator('.presence-feedback').innerText(), '', 'Automatic single-role progress stays out of the batch panel')
  assert.equal(await page.getByRole('button', { name: '查询当前筛选角色在线状态', exact: true }).isEnabled(), true)
  await page.clock.runFor(120_000)
  assert.equal(await count(), 1, 'A slow query never overlaps another scheduled round')
  await finish(0)
  await page.locator('.conversation-presence-status').filter({ hasText: '在线' }).waitFor()
  assert.equal(saves.length, 1, 'Polling saves the actual query result')
  await page.clock.runFor(59_000); assert.equal(await count(), 1)
  await page.clock.runFor(1_010); await waitCount(2)
  await finish(1, 'offline')
  await page.locator('.conversation-presence-status').filter({ hasText: '离线' }).waitFor()

  await page.locator('.character-select-button strong').getByText('Role 2', { exact: true }).click()
  await page.clock.runFor(10); await waitCount(3)
  assert.equal(await page.evaluate(() => window.calls[2].characters[0].characterId), '2')
  await page.locator('.character-select-button strong').getByText('Role 1', { exact: true }).click()
  await page.clock.runFor(10); await waitCount(4)
  assert.equal(await page.evaluate(() => window.calls[2].signal.aborted), true)
  await page.evaluate(() => window.deliver(2, 'online'))
  assert.equal(persisted.has('2'), false, 'A late result from the previous conversation is ignored')
  await interval.selectOption('0')
  await page.waitForFunction(() => window.calls[3].signal.aborted)
  await page.clock.runFor(600_000); assert.equal(await count(), 4, 'Off cancels both the pending request and future rounds')

  await interval.selectOption('30000'); await page.clock.runFor(10); await waitCount(5)
  await finish(4, 'unknown')
  await page.locator('.current-query-feedback[role="alert"]').filter({hasText:'当前没有在线查询客户端'}).waitFor()
  assert.match(await page.locator('.current-query-feedback').innerText(), /查询未全部成功/)
  mkdirSync(root + 'artifacts', { recursive: true })
  await page.screenshot({path:root + 'artifacts/query-error-current.png'})
  await page.clock.runFor(59_000); assert.equal(await count(), 5, 'Unknown results back off instead of retrying rapidly')
  await page.clock.runFor(1_010); await waitCount(6)
  await page.evaluate(() => window.setConnected(false))
  await page.waitForFunction(() => window.calls[5].signal.aborted)
  await page.clock.runFor(600_000); assert.equal(await count(), 6)
  await page.evaluate(() => window.setConnected(true)); await page.clock.runFor(10); await waitCount(7)
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.waitForFunction(() => window.calls[6].signal.aborted)
  await page.clock.runFor(600_000); assert.equal(await count(), 7)
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.clock.runFor(10); await waitCount(8)
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')) })
  await page.waitForFunction(() => window.calls[7].signal.aborted)
  await page.clock.runFor(600_000); assert.equal(await count(), 8)
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); window.dispatchEvent(new Event('online')) })
  await page.clock.runFor(10); await waitCount(9)
  await page.getByRole('tab', { name: '公频', exact: true }).click()
  await page.waitForFunction(() => window.calls[8].signal.aborted)
  await page.clock.runFor(600_000); assert.equal(await count(), 9, 'Public messages do not query the previously selected role')
  await page.getByRole('tab', { name: '私聊', exact: true }).click()
  await page.clock.runFor(10); await waitCount(10)

  await page.getByRole('button', { name: '查询当前筛选角色在线状态', exact: true }).click()
  await waitCount(11)
  assert.equal(await page.evaluate(() => window.calls[9].signal.aborted), true, 'A single batch click cancels the background query and starts the batch')
  assert.equal(await page.evaluate(() => window.calls[10].characters.length), 2)
  await page.clock.runFor(30_010)
  assert.equal(await count(), 11, 'Scheduled and manual queries share the in-flight guard')
  await page.evaluate(() => window.finish(10, 'online'))
  await page.getByText('查询完成：2 个角色，失败 0 个，结果已保存。', { exact: true }).waitFor()
  await page.clock.runFor(5_010); await waitCount(12)
  assert.equal(await page.evaluate(() => window.calls[11].characters.length), 1)
  await finish(11)
  mkdirSync(root + 'artifacts', { recursive: true })
  await page.screenshot({ path: root + 'artifacts/current-presence-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await interval.isVisible(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: root + 'artifacts/current-presence-mobile.png' })
  const uploadStatus = await page.evaluate(() => {
    const sent = { id: 'sent-test', agentId: 'test', type: 'control_sent', content: 'Receipt state test', time: new Date().toISOString(), raw: {requestId:'same-request',payload:{type:'sendWhisper',characterId:'1',serverKey:'1001'}} }
    const receipt = { id: 'receipt-test', agentId: 'test', type: 'control_result', content: 'timeout', time: new Date().toISOString(), raw: {requestId:'same-request',ok:false,status:'unknown',error:'请核对聊天记录，不要自动重发。'} }
    window.setEvents([receipt, sent])
    return window.toUpload(receipt).status
  })
  assert.equal(uploadStatus, 'pending', 'Unconfirmed execution is not persisted as failure')
  await page.getByText('发送结果未确认', { exact: true }).waitFor()
  assert.equal(await page.locator('.send-result.is-failed').count(), 0, 'An unknown receipt must not invite a resend as a confirmed failure')
  await page.setViewportSize({ width: 1400, height: 950 })
  await page.clock.runFor(30_010); await waitCount(13)
  await page.evaluate(() => window.changeAgent({ agentId: 'other', serverId: '2202', host: 'Other' }))
  await page.waitForFunction(() => window.calls[12].signal.aborted)
  await page.clock.runFor(10)
  await page.waitForFunction(() => window.selected?.serverKey === '2202')
  await page.clock.runFor(10); await waitCount(14)
  assert.equal(await page.evaluate(() => window.calls[13].characters[0].serverId), '2202', 'Changing clients never polls the old server')
  await page.evaluate(() => window.changeAgent({ agentId: 'other', serverId: '1305', host: 'Other' }))
  await page.waitForFunction(() => window.calls[13].signal.aborted)
  await page.clock.runFor(10)
  await page.waitForFunction(() => window.selected?.serverKey === '1305')
  await page.clock.runFor(10); await waitCount(15)
  assert.equal(await page.evaluate(() => window.calls[14].characters[0].serverId), '1305', 'Changing the current client server resets its conversation')
  await page.evaluate(() => window.calls[14].reject(new DOMException('Timed out', 'TimeoutError')))
  await page.locator('.current-query-feedback[role="alert"]').filter({hasText:'查询服务响应超时'}).waitFor()
  await page.getByRole('button', { name: '查询当前筛选角色在线状态', exact: true }).click()
  await waitCount(16)
  await page.evaluate(() => window.finish(15, 'unknown'))
  await page.locator('.presence-feedback [role="alert"]').filter({hasText:'区服 1305 当前没有在线查询客户端'}).waitFor()
  await page.getByRole('button', { name: '查询当前筛选角色在线状态', exact: true }).click()
  await waitCount(17)
  assert.equal(await page.locator('.presence-feedback [role="alert"]').count(), 0, 'Starting a retry clears the previous failure')
  await page.evaluate(() => window.unmountChat())
  await page.waitForFunction(() => window.calls[16].signal.aborted)
  await page.clock.runFor(600_000); assert.equal(await count(), 17)
  assert.deepEqual(errors, [])
  console.log('PASS: selected role only, completion-based intervals, serial requests, switching, late replies, off, backoff, reconnect, visibility, network, manual query guard, unmount and responsive UI')
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
