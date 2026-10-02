import { build } from 'esbuild'
import { chromium } from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const built = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AccountManagement} from './src/components/account-management'; createRoot(document.getElementById('root')).render(<AccountManagement/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
const data = { users: [{ id: 1, username: '客服甲', status: 'active' }, { id: 2, username: '客服乙', status: 'active' }], assignments: [{ server_id: '1001', user_ids: [1], version: 1 }], servers: [{ serverId: '1001', serverName: '测试区一' }, { serverId: '1002', serverName: '测试区二' }] }
const mutations = []
const server = createServer(async (req, res) => {
  if (req.url === '/api/admin/accounts') {
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk
      const input = JSON.parse(raw); mutations.push(input)
      if (input.action === 'assign') data.assignments[0] = { server_id: input.serverId, user_ids: input.userIds, version: input.version + 1 }
      if (input.action === 'status') data.users.find(u => u.id === input.userId).status = input.status
      if (input.action === 'create') data.users.push({ id: 3, username: input.username, status: 'active' })
    }
    res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, ...data }))
  }
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(built.outputFiles[0].text) }
  const css = readFileSync('src/styles.css','utf8').replace('@import "tailwindcss";', '')
  res.setHeader('Content-Type','text/html'); res.end(`<meta charset="utf-8"><style>body{font-family:Arial;padding:30px;background:#edf2f1}${css}</style><div id="root"></div><script src="/app.js"></script>`)
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
let browser
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByText('客服甲', { exact: true }).waitFor()
  assert.equal(await page.getByRole('checkbox').count(), 0)
  assert.equal(await page.getByRole('button', { name: '保存分配' }).count(), 0)
  await page.locator('.account-row').first().getByRole('button', { name: '停用' }).click()
  await page.locator('.account-row').first().getByRole('button', { name: '启用' }).waitFor()
  assert.equal(mutations[0].action, 'status')
  await page.locator('.account-row').first().getByRole('button', { name: '启用' }).click()
  await page.locator('.account-row').first().getByRole('button', { name: '停用' }).waitFor()
  await page.getByLabel('客服账号', { exact: true }).fill('new-agent')
  await page.getByLabel('初始密码').fill('test-password-123')
  await page.getByRole('button', { name: '创建客服' }).click()
  await page.getByText('new-agent', { exact: true }).first().waitFor()
  await page.screenshot({ path: 'artifacts/all-servers-accounts.png', fullPage: true })
  await page.getByLabel('搜索客服账号').fill('new-agent')
  assert.equal(await page.locator('.account-row').count(), 1)
  await page.getByLabel('搜索客服账号').fill('')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'artifacts/all-servers-accounts-mobile.png', fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
  console.log('PASS: real React account page, no assignment controls, create/search/disable/enable accounts, no browser errors')
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
