import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const fixture = `
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { useCharacterWindow } from './src/lib/use-character-window'
import { useCharacterDirectory } from './src/lib/use-character-directory'
import { usePresenceQuery } from './src/lib/use-presence-query'
const roles = Array.from({length: 120000}, (_, id) => ({id: String(id), characterId: String(id), serverKey: '1001', name: 'Role ' + id}))
function Fixture() {
  const [query, setQuery] = useState('')
  const windowed = useCharacterWindow(roles, query)
  const lookups = ReactMemo(windowed.items)
  usePresenceQuery(async () => {}, lookups)
  const directory = useCharacterDirectory()
  return <><input aria-label="typing" value={query} onChange={e => setQuery(e.target.value)} />
    <div id="virtual-list" ref={windowed.listRef} style={{height: 500, overflowY: 'auto'}} onScroll={e => windowed.onScroll(e.currentTarget)}>
      <div style={{height: windowed.paddingTop}} />
      {windowed.items.map(role => <button className="row" key={role.id} style={{display: 'block', height: 72}}>{role.name}</button>)}
      <div style={{height: windowed.paddingBottom}} />
    </div>
    <output id="directory">{JSON.stringify({ ids: directory.characters.map(c => c.characterId), total: directory.totalCount, loading: directory.loading })}</output>
    <button onClick={() => directory.loadMore()}>more</button>
    <button onClick={() => directory.selectServer('1002')}>switch</button>
    <button onClick={() => directory.selectRace('2')}>race</button>
    <button onClick={async () => { const all = await directory.loadAll(); document.getElementById('bulk').textContent = String(all.length) }}>bulk</button><output id="bulk" />
  </>
}
import { useMemo } from 'react'
function ReactMemo(items) { return useMemo(() => items.map(c => ({serverId: c.serverKey, characterId: c.characterId})), [items]) }
createRoot(document.getElementById('root')).render(<Fixture />)
`
const bundle = await build({
  stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  alias: { '#': new URL('../src/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') },
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
})
const requests = []
const presenceSizes = []
let delayAppend = false
const role = (id, serverId) => ({ id, characterId: String(id), characterName: `Role ${id}`, serverId, serverName: serverId, legionName: '', level: 1, className: '', faction: '', avatarUrl: '', lastSeenAt: 0 })
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles[0].text); return }
  if (url.pathname.startsWith('/api/')) {
    response.setHeader('Content-Type', 'application/json')
    let body = { ok: true, servers: [], statuses: [] }
    if (url.pathname === '/api/presence/status') {
      let raw = ''; for await (const chunk of request) raw += chunk
      presenceSizes.push(JSON.parse(raw).characters.length)
    } else if (!url.searchParams.has('directory')) {
      requests.push(url)
      const cursor = Number(url.searchParams.get('cursor') || 0)
      const serverId = url.searchParams.get('serverId') || '1001'
      const bulk = url.searchParams.get('bulk') === '1'
      const count = bulk ? Math.min(1000, 2500 - cursor) : 50
      body = { ok: true, characters: Array.from({length: count}, (_, i) => role(cursor + i + (serverId === '1002' ? 200000 : 0), serverId)), nextCursor: bulk && cursor + count >= 2500 ? null : cursor + count, totalCount: url.searchParams.get('includeTotal') === '0' ? null : 120000 }
      if (cursor > 0 && !bulk && delayAppend) await new Promise(resolve => setTimeout(resolve, 400))
    }
    response.end(JSON.stringify(body)); return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end('<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => document.querySelectorAll('.row').length > 0 && !JSON.parse(document.querySelector('#directory').textContent).loading)
  assert.ok(await page.locator('.row').count() < 30)
  await page.locator('#virtual-list').evaluate(list => { list.scrollTop = list.scrollHeight })
  await page.getByText('Role 119999', { exact: true }).waitFor()
  const rowCount = await page.locator('.row').count()
  assert.ok(rowCount < 30, '120k retained records must not create 120k DOM rows')
  await page.getByLabel('typing').fill('responsive')
  await page.getByText('Role 0', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('#virtual-list').scrollTop === 0)
  await page.getByRole('button', { name: 'more', exact: true }).click()
  await page.waitForFunction(() => JSON.parse(document.querySelector('#directory').textContent).ids.length === 100)
  assert.equal(requests.at(-1).searchParams.get('includeTotal'), '0')
  assert.equal(await page.locator('#directory').evaluate(el => JSON.parse(el.textContent).total), 120000)
  delayAppend = true
  await page.getByRole('button', { name: 'more', exact: true }).click()
  await page.getByRole('button', { name: 'switch', exact: true }).click()
  await page.waitForFunction(() => JSON.parse(document.querySelector('#directory').textContent).ids[0] === '200000')
  await page.waitForTimeout(500)
  assert.equal(await page.locator('#directory').evaluate(el => JSON.parse(el.textContent).ids.length), 50, 'Late old pages must not mix with the new server')
  await page.getByRole('button', { name: 'race', exact: true }).click()
  await page.getByRole('button', { name: 'bulk', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#bulk').textContent === '2500')
  const bulkRequests = requests.filter(url => url.searchParams.get('bulk') === '1')
  assert.equal(bulkRequests.length, 3)
  assert.ok(bulkRequests.every(url => url.searchParams.get('includeTotal') === '0' && url.searchParams.get('limit') === '1000'))
  assert.ok(bulkRequests.every(url => url.searchParams.get('raceId') === '2' && !url.searchParams.has('serverId')), 'Every bulk page must preserve race and clear the previous server')
  assert.ok(presenceSizes.length > 0 && presenceSizes.every(size => size < 30), 'Only visible roles are polled')
  assert.deepEqual(errors, [])
  console.log(`PASS: 120,000 roles, ${rowCount} DOM rows at list end; visible-only polling; input/reset; stale-page cancellation; count-free pagination; 2,500 bulk roles in 3 requests`)
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
