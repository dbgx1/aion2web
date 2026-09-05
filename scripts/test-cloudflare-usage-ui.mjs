import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const bundle = await build({ stdin: { contents: `import {createRoot} from 'react-dom/client'; import {CloudflareUsagePage} from './src/components/cloudflare-usage-page'; createRoot(document.getElementById('root')).render(<CloudflareUsagePage isAdmin={location.pathname !== '/agent'}/>);`, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, outdir: 'fixture', platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '#': root + 'src' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
let mode = 'success', requests = 0
const date = new Date().toISOString().slice(0, 10)
const data = { configured: true, accountId: 'a'.repeat(32), today: date, fetchedAt: new Date().toISOString(), refreshAfter: new Date(Date.now() + 300000).toISOString(), storageBytes: 158000000, storageDatabases: 2, errors: [], days: Array.from({ length: 7 }, (_, i) => ({ date: new Date(Date.parse(date) - (6 - i) * 86400000).toISOString().slice(0, 10), requests: 71261, rowsRead: 19523020, rowsWritten: 1164584 })) }
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); return }
  if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(bundle.outputFiles.find(file => file.path.endsWith('.css')).text); return }
  if (req.url === '/api/admin/cloudflare-usage') {
    requests++
    res.setHeader('Content-Type', 'application/json')
    if (mode === 'error') { res.statusCode = 503; res.end(JSON.stringify({ error: '测试：接口暂不可用' })); return }
    res.end(JSON.stringify(mode === 'setup' ? { ...data, configured: false, storageBytes: null, storageDatabases: null, days: data.days.map(day => ({ ...day, requests: null, rowsRead: null, rowsWritten: null })) } : data)); return
  }
  res.setHeader('Content-Type', 'text/html')
  res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;background:#edf2f1;margin:0;padding:32px;box-sizing:border-box}*{box-sizing:border-box}</style><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const url = `http://127.0.0.1:${server.address().port}`
  await page.goto(url)
  await page.getByText('今日有 2 项用量已达到或超过免费日额度。', { exact: true }).waitFor()
  assert.equal(await page.locator('.usage-card.usage-exceeded').count(), 2)
  assert.equal(await page.locator('tbody tr').count(), 7)
  const before = requests
  await page.waitForTimeout(1500)
  assert.equal(requests, before, 'no automatic polling')
  mkdirSync(root + 'artifacts', { recursive: true })
  await page.screenshot({ path: root + 'artifacts/cloudflare-usage-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile page must not overflow horizontally')
  await page.screenshot({ path: root + 'artifacts/cloudflare-usage-mobile.png', fullPage: true })
  mode = 'error'
  await page.getByRole('button', { name: '刷新统计' }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('.usage-card.usage-exceeded').count(), 0)
  mode = 'setup'
  await page.getByRole('button', { name: '刷新统计' }).click()
  await page.getByText('尚未接入 Cloudflare 统计', { exact: true }).waitFor()
  assert.equal(await page.locator('.usage-card.usage-unknown').count(), 4)
  const beforeAgent = requests
  await page.goto(url + '/agent')
  await page.getByText('仅管理员可查看费用统计', { exact: true }).waitFor()
  assert.equal(requests, beforeAgent, 'agent page must not query usage')
  assert.deepEqual(errors, [])
  console.log('PASS: actual component rendering, overage/unknown/error states, no polling, mobile layout, and agent guard; screenshots use fixture data')
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
