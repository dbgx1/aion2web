import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const source = readFileSync(new URL('../src/routes/index.tsx', import.meta.url), 'utf8')
const fixture = `
import { createRoot } from 'react-dom/client'
const testMessage = { id: 'unread-1', agentId: 'test-client', type: 'chat_message', content: 'Off-page reply', time: new Date().toISOString(), raw: { jsonData: { playNcCharId: 'outside-page', userName: 'Unread Role', serverId: '1001', isFromGame: false, content: 'Off-page reply', gameRoomKeyInfo: { type: 'ONE_ON_ONE' } } } }
const outgoingMessage = { ...testMessage, id: 'outgoing-1', content: 'Self sent whisper', raw: { jsonData: { playNcCharId: 'self-character', userName: 'Me', receiverCharacterId: 'sent-target', receiverUserName: 'Sent Target', serverId: '1001', receiverServerId: '1001', isFromGame: true, content: 'Self sent whisper', gameRoomKeyInfo: { type: 'ONE_ON_ONE' } } } }
const publicMessage = { ...testMessage, id: 'public-1', content: 'Ordinary channel content', raw: { jsonData: { playNcCharId: 'outside-page', userName: 'Unread Role', serverId: '1001', isFromGame: false, content: 'Ordinary channel content', gameRoomKeyInfo: { type: 'GROUP' } } } }
const otherPublicMessage = { ...publicMessage, id: 'public-2', raw: { jsonData: { playNcCharId: 'public-only', userName: 'Public Only Role', serverId: '1001', isFromGame: false, content: 'Ordinary channel content', gameRoomKeyInfo: { type: 'GROUP' } } } }
const testMessages = [publicMessage, otherPublicMessage, outgoingMessage, testMessage]
function Fixture() {
  const [messages, setMessages] = useState(testMessages)
  const [content,setContent] = useState('')
  useEffect(() => {
    const receive = () => setMessages(current => [{ ...testMessage, id: 'unread-2', content: 'New private reply' }, ...current])
    window.addEventListener('test-private-reply', receive)
    const replace = event => setMessages(event.detail)
    window.addEventListener('test-timeline', replace)
    return () => {
      window.removeEventListener('test-private-reply', receive)
      window.removeEventListener('test-timeline', replace)
    }
  }, [])
  const [selectedCharacter, selectCharacter] = useState()
  const [readMessageIds, setReadMessageIds] = useState(new Set())
  const onMessagesRead = useCallback((ids) => setReadMessageIds(current => ids.every(id => current.has(id)) ? current : new Set([...current, ...ids])), [])
  return <MessageCenter agent={{ agentId: 'test-client', serverId: '1001', host: 'Test', room: 'test' }}
    selectedCharacter={selectedCharacter} onCharacterSelect={selectCharacter}
    agentMessages={messages} messages={selectedCharacter ? messages.filter(message => messageBelongsToCharacter(message, selectedCharacter)) : []}
    readMessageIds={readMessageIds} onMessagesRead={onMessagesRead}
    content={content} actionMessage="" onBack={() => {}} onContentChange={setContent} onSend={() => {window.privateSends=(window.privateSends||0)+1}}
    onSendPrivateChat={() => false} onSendAll={async () => {window.bulkSends=(window.bulkSends||0)+1;return {}}} onStopBulkSend={() => {}}
    bulkSending={false} canOperate={true} lockOwner="" bulkIntervalRangeMs={{min:2200,max:4500}} onBulkIntervalRangeChange={() => {}} />
}
createRoot(document.getElementById('root')).render(<Fixture />)
`
const bundle = await build({
  stdin: { contents: source + fixture, resolveDir: new URL('../src/routes/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), loader: 'tsx' },
  bundle: true, write: false, outdir: 'fixture', format: 'iife', platform: 'browser', jsx: 'automatic',
  alias: { '#': new URL('../src/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
  logLevel: 'silent',
})
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/^@import.*$/gm, '')
const role = (id, characterId = String(id), serverId = '1001') => ({ id, characterId, serverId, characterName: `Role ${id}`, serverName: serverId, legionName: 'Test Legion', level: 50, className: 'Test', faction: '', avatarUrl: '', lastSeenAt: 0 })
const unreadRole = { ...role(999, 'outside-page'), characterName: 'Unread Role' }
let lookupCount = 0
let characterListRequests = 0
let historyMessages = []
const largeLegionDirectory = Array.from({ length: 14395 }, (_, index) => ({ legionName: `军团${String(index + 1).padStart(5, '0')}`, memberCount: 5 }))
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); return }
  if (url.pathname === '/styles.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return }
  if (url.pathname.startsWith('/api/')) {
    response.setHeader('Content-Type', 'application/json')
    let body = { ok: true, messages: [], statuses: [], nextCursor: null }
    if (url.pathname === '/api/messages' && url.searchParams.get('characterId') === '1') body.messages = historyMessages
    if (url.pathname === '/api/characters') {
      if (url.searchParams.has('directory')) body = { ok: true, servers: ['1001', '1002', '2001'].map(serverId => ({ serverId, serverName: serverId, raceId: serverId === '2001' ? 2 : 1, characterCount: 1539, unaffiliatedCount: 0, legions: [{ legionName: 'Test Legion', memberCount: 1539 }, ...(serverId === '1001' ? largeLegionDirectory : [])] })) }
      else if (url.searchParams.has('characterId')) {
        lookupCount++
        assert.ok(['outside-page', '1'].includes(url.searchParams.get('characterId')))
        assert.equal(url.searchParams.get('serverId'), '1001')
        body = { ok: true, characters: [url.searchParams.get('characterId') === '1' ? role(1) : unreadRole], nextCursor: null, totalCount: null }
      } else { characterListRequests++; body = { ok: true, characters: Array.from({length: 50}, (_, i) => role(i + 1)), nextCursor: 50, totalCount: 1539 } }
    }
    response.end(JSON.stringify(body)); return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(10_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const choose = async (label, name) => {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('combobox', { name: `搜索${label}`, exact: true }).fill(name)
    await page.getByRole('option').filter({ hasText: name }).first().click()
  }
  await page.locator('.character-card').first().waitFor()
  assert.equal(await page.locator('.filter-controls option').count(), 0, 'Closed filters must not mount 14k native options')
  const listRequestsBeforeOpen = characterListRequests
  const openedAt = performance.now()
  await page.getByRole('button', {name: '选择军团', exact: true}).click()
  await page.getByRole('option').first().waitFor()
  const openMs = Math.round(performance.now() - openedAt)
  const optionCount = await page.getByRole('option').count()
  assert.ok(optionCount <= 15, 'Expanded filter must render a bounded window')
  if (process.env.FILTER_SCREENSHOT_PATH) await page.screenshot({ path: process.env.FILTER_SCREENSHOT_PATH })
  const combo = page.getByRole('combobox', {name: '搜索选择军团', exact: true})
  await combo.fill('军团14395')
  await page.getByRole('option', {name: '军团14395 (5)', exact: true}).waitFor()
  assert.equal(await page.getByRole('option').count(), 1)
  await combo.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  assert.equal(await page.getByRole('dialog', {name: '选择军团', exact: true}).count(), 1, 'IME confirmation must not select an option')
  await combo.fill('')
  await combo.press('Control+End')
  await page.waitForFunction(() => {
    const input = document.querySelector('.searchable-select-search input')
    const active = document.getElementById(input?.getAttribute('aria-activedescendant'))
    return active && active.getAttribute('aria-posinset') === active.getAttribute('aria-setsize')
  })
  await combo.press('Escape')
  assert.equal(await page.getByRole('option').count(), 0)
  assert.equal(characterListRequests, listRequestsBeforeOpen, 'Opening and searching choices must not fetch characters')
  await choose('选择军团', '军团14395')
  await page.getByRole('button', {name: '选择军团', exact: true}).click()
  await page.getByRole('option', {name: '军团14395 (5)', exact: true}).waitFor()
  assert.equal(await page.getByRole('option', {name: '军团14395 (5)', exact: true}).getAttribute('aria-selected'), 'true', 'Reopening must scroll to the selected option')
  await page.getByRole('combobox', {name: '搜索选择军团', exact: true}).press('Escape')
  await choose('选择军团', '全部军团')
  const unreadTab = page.getByRole('tab', { name: '未读' })
  await unreadTab.click()
  const card = page.locator('.character-select-button').filter({ hasText: 'Unread Role' })
  await card.waitFor()
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).searchParams.get('raceId') === '2'),
    choose('选择种族', '魔族'),
  ])
  await page.getByText('当前筛选条件下暂无未读消息', {exact: true}).waitFor()
  await page.getByRole('button', {name: '选择区服', exact: true}).click()
  assert.equal(await page.getByRole('option').count(), 2)
  await page.getByRole('option').filter({hasText: '2001'}).click()
  await page.getByRole('button', {name: '选择军团', exact: true}).click()
  await page.getByRole('combobox', {name: '搜索选择军团', exact: true}).fill('军团00001')
  await page.getByText('没有匹配的选项', {exact: true}).waitFor()
  await page.getByRole('combobox', {name: '搜索选择军团', exact: true}).press('Escape')
  await choose('选择军团', 'Test Legion')
  await choose('选择种族', '天族')
  assert.equal(await page.getByRole('button', {name: '选择区服', exact: true}).innerText(), '全部区服')
  assert.equal(await page.getByRole('button', {name: '选择军团', exact: true}).innerText(), '全部军团')
  await card.waitFor()
  await choose('选择种族', '全部种族')
  await page.waitForFunction(() => !document.body.textContent.includes('正在加载未读会话'))
  assert.equal(await page.locator('.character-card').count(), 1)
  assert.equal(await page.locator('.character-load-more').count(), 0)
  assert.match(await unreadTab.innerText(), /1/)
  await page.getByPlaceholder('搜索角色或 ID').fill('not-a-match')
  await page.getByText('当前筛选条件下暂无未读消息', {exact: true}).waitFor()
  assert.match(await unreadTab.innerText(), /0/)
  await page.getByPlaceholder('搜索角色或 ID').fill('')
  await card.waitFor()
  await choose('选择区服', '1002')
  await page.getByText('当前筛选条件下暂无未读消息', {exact: true}).waitFor()
  await choose('选择区服', '全部区服')
  await card.waitFor()
  await choose('选择军团', '未加入军团')
  await page.getByText('当前筛选条件下暂无未读消息', {exact: true}).waitFor()
  await choose('选择军团', '全部军团')
  await card.waitFor()
  await card.click()
  await page.getByRole('heading', { name: 'Unread Role', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.character-message-tabs .is-active')?.textContent === '未读0')
  assert.equal(await card.count(), 1, 'Reading a reply must keep the member in the list')
  assert.equal(await card.locator('em').count(), 0, 'Only the unread badge should disappear')
  await unreadTab.click()
  assert.equal(await card.count(), 1, 'Clicking the active unread tab must not reset the list')
  assert.equal(await page.getByText('Ordinary channel content', { exact: true }).count(), 0, 'Public messages must not enter private chat')
  assert.match(await unreadTab.innerText(), /0/)
  await page.getByRole('tab', {name: '消息', exact: true}).click()
  assert.equal(await page.getByRole('heading', { name: 'Unread Role', exact: true }).count(), 1)
  await unreadTab.click()
  await page.getByText('当前筛选条件下暂无未读消息', {exact: true}).waitFor()
  assert.equal(await card.count(), 0, 'Read members are removed when re-entering unread')
  await page.getByRole('tab', {name: '消息', exact: true}).click()
  await page.locator('.character-select-button strong').getByText('Role 2', { exact: true }).click()
  await unreadTab.click()
  await page.evaluate(() => window.dispatchEvent(new Event('test-private-reply')))
  await card.waitFor()
  await page.waitForFunction(() => document.querySelector('.character-message-tabs .is-active')?.textContent === '未读1')
  assert.equal(await card.locator('em').innerText(), '1', 'New private replies bring the member back')
  assert.equal(lookupCount, 1, 'Unrelated filters must not refetch the unread character')
  await page.getByRole('tab', {name: /^消息/}).click()
  assert.ok(await page.locator('.character-card').count() < 30, 'MessageCenter must render only the visible character window')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', {name: '选择军团', exact: true}).click()
  const bounds = await page.getByRole('dialog', {name: '选择军团', exact: true}).boundingBox()
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844, 'Popup must stay inside a narrow viewport')
  await page.getByRole('combobox', {name: '搜索选择军团', exact: true}).press('Tab')
  assert.equal(await page.getByRole('dialog', {name: '选择军团', exact: true}).count(), 0, 'Tab must close the popup')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.reload()
  await page.locator('.character-card').first().waitFor()
  const sendEvents = (characterId, requestId, guid) => {
    const base = { agentId: 'test-client', content: '121', time: '2026-09-04T13:46:14.000Z' }
    return [
      { ...base, id: `sent-${requestId}`, type: 'control_sent', raw: { payload: { type: 'sendWhisper', requestId, characterId, serverKey: '1001', content: '121' } } },
      // Real receipts can have no target. Only the exact request may link them to a character.
      { ...base, id: `result-${requestId}`, type: 'control_result', raw: { requestId, ok: true, result: { response: { guid } } } },
      { ...base, id: `echo-${requestId}`, type: 'chat_message', time: '2026-09-04T13:46:10.000Z', raw: { payload: { jsonData: { guid, receiverCharacterId: characterId, receiverServerId: '1001', isFromGame: true, content: '121', gameRoomKeyInfo: { type: 'ONE_ON_ONE' } } } } },
    ]
  }
  const bulkEvents = [...sendEvents('1', 'request-1', '1413294121202344960'), ...sendEvents('2', 'request-2', '1413294133705824256')]
  await page.evaluate(messages => window.dispatchEvent(new CustomEvent('test-timeline', { detail: messages })), bulkEvents)
  for (const name of ['Role 1', 'Role 2']) {
    await page.locator('.character-select-button strong').getByText(name, { exact: true }).click()
    await page.getByRole('heading', { name, exact: true }).waitFor()
    await page.locator('.chat-message .send-result.is-success').waitFor()
    assert.equal(await page.locator('.chat-message').count(), 1, `${name}: one bulk send must show one bubble`)
    assert.equal(await page.locator('.chat-message > div > p').innerText(), '121')
  }
  const repeated = [...bulkEvents, ...sendEvents('1', 'request-3', '1413294133705824257')]
  await page.evaluate(messages => window.dispatchEvent(new CustomEvent('test-timeline', { detail: messages })), repeated)
  await page.locator('.character-select-button strong').getByText('Role 1', { exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.chat-message .send-result.is-success').length === 2)
  assert.equal(await page.locator('.chat-message').count(), 2, 'Two actual identical sends remain two bubbles')
  historyMessages = bulkEvents.slice(0, 3).map((message, index) => ({
    id: index + 1, sourceMessageId: message.id, requestId: index === 2 ? '' : 'request-1', agentId: 'test-client',
    messageType: message.type, direction: index === 1 ? 'system' : 'outgoing', content: message.content,
    gameMessageId: '1413294121202344960', status: 'sent', errorMessage: '', sentAt: Date.parse(message.time), createdAt: 1,
  }))
  await page.reload()
  await page.locator('.character-select-button strong').getByText('Role 1', { exact: true }).click()
  await page.locator('.chat-message .send-result.is-success').waitFor()
  assert.equal(await page.locator('.chat-message').count(), 1, 'Reloaded history merges sent and echo')
  // A command must retain its final status even if its receipt is outside this page.
  const fullHistory=historyMessages
  historyMessages=[{...fullHistory[0],status:'delivered'}]
  await page.reload()
  await page.locator('.chat-message .send-result.is-success').waitFor()
  assert.equal(await page.locator('.send-result.is-pending').count(),0)
  historyMessages=[{...fullHistory[0],status:'delivered'},
    {...fullHistory[0],id:88,agentId:'another-client',sourceMessageId:'another-send',gameMessageId:'another-guid',status:'failed',errorMessage:'other client failure'}]
  await page.reload()
  await page.getByText('other client failure',{exact:true}).waitFor()
  assert.equal(await page.locator('.send-result.is-success').count(),1,'Same request ID on another agent cannot replace delivery status')
  assert.equal(await page.locator('.send-result.is-failed').count(),1)
  historyMessages=[{...fullHistory[0],status:'failed',errorMessage:'receipt outside page rejected'}]
  await page.reload()
  await page.getByText('receipt outside page rejected',{exact:true}).waitFor()
  assert.equal(await page.locator('.send-result.is-pending').count(),0)
  historyMessages=fullHistory
  await page.reload()
  await page.locator('.chat-message .send-result.is-success').waitFor()
  await page.evaluate(messages => window.dispatchEvent(new CustomEvent('test-timeline', { detail: messages })), bulkEvents)
  await page.waitForFunction(() => document.querySelector('.character-card')?.textContent.includes('121'))
  assert.equal(await page.locator('.chat-message').count(), 1, 'Live replay does not duplicate stored history')
  await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.testVisibility||'visible'}))
  await page.evaluate(()=>{window.testVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'))})
  const incoming = {id:'hidden-reply',agentId:'test-client',type:'chat_message',content:'unread while hidden',time:new Date().toISOString(),raw:{jsonData:{playNcCharId:'1',serverId:'1001',isFromGame:false,gameRoomKeyInfo:{type:'ONE_ON_ONE'}}}}
  await page.evaluate(message=>window.dispatchEvent(new CustomEvent('test-timeline',{detail:[message]})),incoming)
  await page.waitForFunction(()=>document.querySelectorAll('.character-message-tabs button')[1].textContent==='未读1')
  await page.evaluate(()=>{window.testVisibility='visible';document.dispatchEvent(new Event('visibilitychange'))})
  assert.equal(await page.locator('.character-message-tabs button').nth(1).textContent(), '未读1', 'Restoring visibility must not read the automatically selected conversation')
  await page.locator('.character-select-button').filter({hasText:'Role 1'}).first().click()
  await page.waitForFunction(()=>document.querySelectorAll('.character-message-tabs button')[1].textContent==='未读0')
  const composer=page.getByPlaceholder('发送消息给 Role 1')
  await composer.fill('中文输入')
  await composer.dispatchEvent('keydown',{key:'Enter',isComposing:true})
  assert.equal(await page.evaluate(()=>window.privateSends||0),0,'IME confirmation must not send a private message')
  await composer.press('Enter')
  assert.equal(await page.evaluate(()=>window.privateSends),1)
  await page.locator('.broadcast-character').click()
  const bulkComposer=page.locator('.chat-composer textarea')
  await bulkComposer.dispatchEvent('keydown',{key:'Enter',isComposing:true})
  assert.equal(await page.evaluate(()=>window.bulkSends||0),0,'IME confirmation must not start a bulk send')
  await bulkComposer.press('Enter')
  assert.equal(await page.evaluate(()=>window.bulkSends),1)
  assert.deepEqual(errors, [])
  console.log('PASS: hidden replies stay unread until visible; Chinese IME Enter does not send private or bulk messages')
  console.log('PASS: actual MessageCenter merges bulk receipts per recipient, preserves real repeated sends, and handles reload/live replay')
  console.log(`PASS: 14,396 legions, ${optionCount} mounted choices, ${openMs}ms open including browser automation; search, keyboard, IME, selected-item scroll; off-page replies, filters, retained during reading, new replies, cached lookup, no browser errors`)
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
