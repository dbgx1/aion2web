import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const source = readFileSync(root + 'src/routes/index.tsx', 'utf8')
  .replace('const consoleApi = useAionConsole()', 'const consoleApi = useAionConsole(); window.fixtureApi = consoleApi')
const fixture = `
import {createRoot} from 'react-dom/client';
function Fixture(){const [section,setSection]=useState('messages');window.setSection=setSection;return <AuthenticatedHome section={section} user={{userKey:'a',username:'Alice',role:'agent'}} onLogout={()=>{}}/>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
const bundle = await build({
  stdin: { contents: source + fixture, resolveDir: root + 'src/routes', loader: 'tsx' },
  bundle: true, write: false, outdir: 'fixture', platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { '#': root + 'src' }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' }, logLevel: 'silent',
  plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /^(@tanstack\/react-router|mqtt)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir: root, loader: 'tsx', contents: args.path === 'mqtt' ? `
      export function connect(){const handlers=new Map();const client={connected:true,on(type,fn){handlers.set(type,fn);if(type==='connect')setTimeout(fn,0);return client},subscribe(topics,callback){callback?.()},end(){client.connected=false},publish(topic,json){if(JSON.parse(json).type==='discover')window.heartbeat()}};
        window.receive=value=>handlers.get('message')('aion2-chat-bridge/aion2-local/events/A1/chat',new TextEncoder().encode(JSON.stringify(value)));
        window.reply=(role,id)=>window.receive({type:'MESSAGE',method:'GAME',message_id:id,agentId:'A1',time:'2026-09-05T00:00:00.000Z',payload:{jsonData:{playNcCharId:String(role),userName:'Role '+role,serverId:'1001',isFromGame:false,content:id,gameRoomKeyInfo:{type:'ONE_ON_ONE'}}}});
        window.noise=()=>{for(let i=0;i<650;i++)window.receive({type:'control_result',agentId:'A1',requestId:'receipt-'+i,ok:true,time:new Date().toISOString()})};
        window.heartbeat=()=>handlers.get('message')('aion2-chat-bridge/aion2-local/agents/A1/status',new TextEncoder().encode(JSON.stringify({type:'agent_status',agentId:'A1',host:'A1',room:'aion2-local',serverId:'1001',status:'online',time:new Date().toISOString()})));
        return client;
      }` : `import React from 'react';export const createFileRoute=()=>v=>v;export const useNavigate=()=>()=>{};export const Link=({children,to,...props})=><a href={to} {...props}>{children}</a>;` }))
  } }],
})
const css = readFileSync(root + 'src/styles.css', 'utf8').replace(/^@import.*$/gm, '')
const characters = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, characterId: String(i + 1), characterName: 'Role ' + (i + 1), serverId: '1001', serverName: 'Test', legionName: '', className: '', level: 1, faction: '', avatarUrl: '', lastSeenAt: 0 }))
const server = createServer(async (req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles.find(x => x.path.endsWith('.js')).text); return }
  if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
  if (req.url.startsWith('/api/')) {
    let body = { ok: true, characters, servers: [], messages: [], nextCursor: null, totalCount: 3, locks: [{ agentId: 'A1', userKey: 'a', username: 'Alice', acquiredAt: 100, expiresAt: 0 }] }
    if (req.url === '/api/messages' && req.method === 'POST') {
      let raw = ''; for await (const part of req) raw += part
      body = { ok: true, conversations: JSON.parse(raw).conversations.map(c => ({ ok: true, serverId: c.serverId, characterId: c.characterId, received: c.messages.length })) }
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return
  }
  res.setHeader('Content-Type', 'text/html'); res.end('<link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = []
  page.setDefaultTimeout(10_000)
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    // Reproduce live failure: no remembered selection, but server owns A1.
    window.fixtureFocus = true
    Object.defineProperty(document, 'hasFocus', { value: () => window.fixtureFocus })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByPlaceholder('发送消息给 Role 1').waitFor()
  assert.equal(await page.evaluate(()=>localStorage.getItem('aion2-selected-agent-id')),'A1','Existing owned client restores a missing selection')
  const count = () => page.evaluate(() => window.fixtureApi.inboxMessages.filter(m => !window.fixtureApi.readMessageIds.has(m.id)).length)
  const readCount = async n => {
    try { await page.waitForFunction(n => window.fixtureApi.inboxMessages.filter(m => !window.fixtureApi.readMessageIds.has(m.id)).length === n, n) }
    catch (error) {
      console.log(await page.evaluate(() => ({focus:document.hasFocus(),visibility:document.visibilityState,unread:window.fixtureApi.inboxMessages.filter(m=>!window.fixtureApi.readMessageIds.has(m.id)).map(m=>m.content),thread:document.querySelector('.chat-thread')?.getBoundingClientRect().toJSON(),articles:[...document.querySelectorAll('[data-incoming-id]')].map(el=>({id:el.dataset.incomingId,rect:el.getBoundingClientRect().toJSON()}))})))
      throw error
    }
  }
  const clickRole = n => page.locator('.character-select-button').filter({ hasText: 'Role ' + n }).click()
  // One synchronous burst exceeds the log before React has rendered any reply.
  await page.evaluate(() => { window.reply(1, 'unopened-first'); window.reply(2, 'unopened-second'); window.noise() })
  await readCount(2)
  assert.equal(await page.evaluate(() => window.fixtureApi.messages.length), 500)
  assert.equal(await page.evaluate(() => window.fixtureApi.messages.some(m => m.type === 'chat_message')), false)
  assert.equal(await page.evaluate(() => window.fixtureApi.readMessageIds.size), 0, 'automatic first selection cannot read')
  await clickRole(1); await readCount(1)
  await page.getByText('unopened-first', { exact: true }).last().waitFor()
  await page.evaluate(() => { window.fixtureFocus = false; window.dispatchEvent(new Event('blur')); window.reply(1, 'background-reply') })
  await readCount(2)
  await page.evaluate(() => { window.fixtureFocus = true; window.dispatchEvent(new Event('focus')) })
  await readCount(1)
  await page.evaluate(() => window.setSection('settings'))
  await page.getByPlaceholder('发送消息给 Role 1').waitFor({ state: 'detached' })
  await page.evaluate(() => { window.reply(1, 'away-reply'); window.setSection('messages') })
  await page.getByPlaceholder('发送消息给 Role 1').waitFor(); await readCount(2)
  await clickRole(1); await readCount(1)
  await page.getByRole('tab', { name: '未读' }).click()
  await clickRole(2); await readCount(0)
  await page.getByText('unopened-second', { exact: true }).last().waitFor()
  assert.equal(await page.locator('.character-select-button').filter({ hasText: 'Role 2' }).count(), 1, 'reading keeps the current unread-tab conversation')
  await page.evaluate(() => { window.reply(1, 'unopened-first'); window.noise(); window.fixtureApi.clearMessages() })
  assert.equal(await count(), 0, 'duplicate replies stay read after log rotation and clearing')
  await page.getByRole('tab', { name: '消息', exact: true }).click()
  await page.evaluate(() => { for (let i = 0; i < 40; i++) window.reply(3, 'scroll-reply-' + i) })
  await readCount(40)
  await clickRole(3)
  await page.waitForFunction(() => { const api=window.fixtureApi; const n=api.inboxMessages.filter(m=>!api.readMessageIds.has(m.id)).length; return n>0&&n<40 })
  const before = await count()
  await page.locator('.chat-thread').evaluate(el => { el.scrollTop = el.scrollHeight })
  await page.waitForFunction(before => window.fixtureApi.inboxMessages.filter(m => !window.fixtureApi.readMessageIds.has(m.id)).length < before, before)
  assert.ok(await count() > 0, 'messages skipped in the middle remain unread')
  await page.evaluate(() => window.fixtureApi.clearMessages())
  assert.ok(await count() > 0, 'clearing the console log cannot clear unread replies')
  const navBadge = page.locator('.side-nav .nav-item').filter({hasText:'实时消息'}).locator('em')
  const beforeOtherClient = await navBadge.textContent()
  await page.evaluate(()=>window.receive({type:'MESSAGE',method:'GAME',message_id:'other-client-unread',agentId:'A2',time:new Date().toISOString(),payload:{jsonData:{playNcCharId:'1',userName:'Other Client',serverId:'1001',isFromGame:false,content:'other client reply',gameRoomKeyInfo:{type:'ONE_ON_ONE'}}}}))
  await page.waitForFunction(()=>window.fixtureApi.inboxMessages.some(m=>m.agentId==='A2'))
  assert.equal(await navBadge.textContent(),beforeOtherClient,'Other clients must not inflate the current client navigation unread badge')
  await page.evaluate(()=>window.fixtureApi.setSelectedAgentId('A2'))
  await page.waitForFunction(()=>document.querySelector('.side-nav .nav-item[disabled] em')?.textContent==='1')
  await page.evaluate(()=>window.fixtureApi.setSelectedAgentId('A1'))
  await page.getByPlaceholder('发送消息给 Role 3').waitFor()
  assert.equal(await navBadge.textContent(),beforeOtherClient,'Switching back restores that client unread count')
  assert.deepEqual(errors, [])
  console.log('PASS: >500 receipts retain unread; auto-selection, page remount, background focus, viewport reading, deduplication, and console clearing')
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
