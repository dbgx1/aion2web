import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const base = 'https://mmorpgchat.com'
const result = { checkedAt: new Date().toISOString(), base, pages: [], assets: [], auth: [] }
const hash = value => createHash('sha256').update(value).digest('hex')
for (const path of ['/', '/messages']) {
  const response = await fetch(base + path)
  const html = await response.text()
  assert.equal(response.status, 200, path)
  assert.match(html, /<html/)
  result.pages.push({ path, status: response.status })
  const references = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)[^"]*"/g)].map(match => match[1])
  assert.ok(references.length, 'Page should reference built assets')
  for (const asset of references) await readFile(new URL('../dist/client' + asset, import.meta.url))
}
const assets = await readdir(new URL('../dist/client/assets/', import.meta.url))
for (const name of assets.filter(name => /\.(js|css)$/.test(name))) {
  const response = await fetch(base + '/assets/' + name)
  assert.equal(response.status, 200, name)
  const deployed = Buffer.from(await response.arrayBuffer())
  const local = await readFile(new URL('../dist/client/assets/' + name, import.meta.url))
  assert.equal(hash(deployed), hash(local), 'Deployed asset mismatch: ' + name)
  result.assets.push({ name, sha256: hash(deployed), matches: true })
}
for (const [path, method, body] of [
  ['/api/auth', 'GET'],
  ['/api/mqtt/connection', 'GET'],
  ['/api/messages?serverId=1001&characterId=1', 'GET'],
  ['/api/presence/status', 'POST', { characters: [{ serverId: '1001', characterId: '1' }] }],
]) {
  const response = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  assert.equal(response.status, 401, 'Unauthenticated endpoint: ' + path)
  result.auth.push({ path, method, status: response.status })
}
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base + '/messages', { waitUntil: 'networkidle' })
  await page.locator('input[type="password"]').waitFor()
  assert.deepEqual(errors, [], 'Production page JavaScript errors')
  await page.screenshot({ path: new URL('./realtime-release-live.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') })
  result.browser = { loginVisible: true, errors }
} finally { await browser.close() }
await writeFile(new URL('./realtime-release-live-check.json', import.meta.url), JSON.stringify(result, null, 2) + '\n')
console.log(`PASS: ${result.pages.length} production pages, ${result.assets.length} matching assets, ${result.auth.length} authentication checks and browser render`)
