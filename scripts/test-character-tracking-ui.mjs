import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const character = { id: '1', name: '重点角色', characterId: '12345', serverKey: '1001', serverName: '测试区服', legionName: '测试军团', className: '剑星', level: 45, combatPower: 120000, avatarColor: '#abc', avatarUrl: '', faction: '', lastSeenAt: 1 }
const bundle = await build({ stdin: { contents: `import {createRoot} from 'react-dom/client'; import {TrackingProvider,TrackingButton,TrackingStar} from './src/components/character-tracking'; createRoot(document.getElementById('root')).render(<TrackingProvider><TrackingButton onSelect={c=>document.getElementById('selected').textContent=c.name}/><TrackingStar character={${JSON.stringify(character)}}/></TrackingProvider>);`, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '#': root + 'src' }, define: { 'process.env.NODE_ENV': '"production"' } })
let active = false, entry = { character, priority: 'medium', status: 'pending', notes: '', nextFollowUp: null, updatedAt: 1 }, fail = false
let occupied = false, conflict = false
const unexpected = []
const server = createServer(async (req, res) => {
 if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
 if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(readFileSync('src/styles.css')); return }
 if (req.url === '/api/character-tracking') {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'POST') {
   let raw = ''; for await (const chunk of req) raw += chunk
   const input = JSON.parse(raw)
   if (conflict && input.action==='add') { occupied=true; res.statusCode=409; res.end(JSON.stringify({ok:false,error:'该角色已由 客服甲 重点跟踪，不能重复添加。'})); return }
   if (fail) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: '测试保存失败' })); return }
   if (input.action === 'add') active = true
   if (input.action === 'remove') active = false
   if (input.action === 'update') entry = { ...entry, ...input }
   res.end(JSON.stringify({ ok: true })); return
  }
  res.end(JSON.stringify({ ok: true, entries: active ? [entry] : [], claims: occupied ? [{characterId:'1',ownerName:'客服甲',isMine:false}] : [] })); return
 }
 if (req.url?.startsWith('/api/')) unexpected.push(req.url)
 res.setHeader('Content-Type', 'text/html'); res.end('<html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><div id="selected"></div><script src="/bundle.js"></script></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
 const page = await browser.newPage({ viewport: { width: 1400, height: 850 } }), errors = []
 page.on('pageerror', e => errors.push(e.message))
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByRole('button', { name: '加入重点跟踪：重点角色', exact: true }).click()
 await page.getByRole('button', { name: /重点跟踪 1/ }).click()
 const dialog = page.getByRole('dialog')
 await dialog.getByRole('button', { name: '跟进', exact: true }).click()
 await page.getByLabel('优先级', { exact: true }).selectOption('high')
 await page.getByLabel('跟进状态', { exact: true }).selectOption('waiting')
 await page.getByLabel('下次跟进时间（本地时间）').fill('2025-01-01T10:30')
 await page.getByLabel('跟进备注').fill('确认需求，下次继续沟通')
 fail = true
 await page.getByRole('button', { name: '保存跟进', exact: true }).click()
 await dialog.getByRole('alert').waitFor()
 assert.equal(await page.getByLabel('跟进备注').inputValue(), '确认需求，下次继续沟通')
 fail = false
 await page.getByRole('button', { name: '保存跟进', exact: true }).click()
 await dialog.getByText('确认需求，下次继续沟通', { exact: true }).waitFor()
 await page.getByLabel('跟进筛选').selectOption('overdue')
 assert.equal(await dialog.locator('tbody tr').count(), 1)
 mkdirSync('artifacts', { recursive: true })
 await page.screenshot({ path: 'artifacts/character-tracking.png' })
 await dialog.getByRole('button', { name: '打开聊天' }).click()
 assert.equal(await page.locator('#selected').innerText(), character.name)
 await page.reload()
 await page.getByRole('button', { name: /重点跟踪 1/ }).click()
 await dialog.getByText('确认需求，下次继续沟通', { exact: true }).waitFor()
 await dialog.getByRole('button', { name: '移出重点跟踪：重点角色' }).click()
 await dialog.getByText(/还没有重点角色/).waitFor()
 await page.getByRole('button', { name: '关闭重点跟踪' }).click()
 await page.getByRole('button', { name: '加入重点跟踪：重点角色' }).click()
 await page.getByRole('button', { name: /重点跟踪 1/ }).click()
 await dialog.getByText('确认需求，下次继续沟通', { exact: true }).waitFor()
 await page.setViewportSize({ width: 390, height: 844 })
 assert.ok(await dialog.evaluate(el => el.getBoundingClientRect().width <= window.innerWidth))
 await page.getByRole('button',{name:'关闭重点跟踪'}).click()
 active=false; occupied=true; await page.reload()
 const blocked=page.getByRole('button',{name:'已由 客服甲 跟踪：重点角色',exact:true})
 await blocked.waitFor(); assert.equal(await blocked.isDisabled(),true)
 assert.equal(await page.getByText('客服甲 跟踪中',{exact:true}).isVisible(),true)
 occupied=false; await page.reload()
 conflict=true; await page.getByRole('button',{name:'加入重点跟踪：重点角色',exact:true}).click()
 await blocked.waitFor(); assert.equal(await blocked.isDisabled(),true)
 await page.getByRole('alert').filter({hasText:'不能重复添加'}).waitFor()
 conflict=false;occupied=false;await page.reload()
 await page.getByRole('button',{name:'加入重点跟踪：重点角色',exact:true}).click()
 await page.getByRole('button',{name:'移出重点跟踪：重点角色',exact:true}).waitFor()
 assert.deepEqual(errors, [])
 assert.deepEqual(unexpected, [])
 console.log('PASS: star, editor, error recovery, due filter, reload, remove/restore, open chat without sending and mobile dialog')
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
