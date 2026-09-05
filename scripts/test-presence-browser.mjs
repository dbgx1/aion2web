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
import { queryPresenceMqtt } from '#/lib/presence-mqtt'
const callbacks = new Map()
const client = {
  connected: true,
  on(type, fn) { callbacks.set(type, fn) },
  removeListener(type) { callbacks.delete(type) },
  unsubscribe() {},
  subscribe(topic, options, callback) { callback(null, [{topic, qos:1}]) },
  publish(topic, json, options, callback) { window.presenceCommand = JSON.parse(json); callback() },
}
window.presenceReply = results => callbacks.get('message')?.(window.presenceCommand.replyTopic,
  new TextEncoder().encode(JSON.stringify({type:'presence_result', requestId:window.presenceCommand.requestId, results})))
window.presenceListening = () => callbacks.has('message')
const query = async (characters, receive, signal) => {
  const response = await fetch('/api/presence/requests', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({characters})})
  const body = await response.json()
  return queryPresenceMqtt(client, body.query, receive, signal)
}
function Fixture() {
  const [character, select] = useState()
  return <MessageCenter agent={{agentId:'A4',serverId:'1001',host:'A4',room:'r'}}
    selectedCharacter={character} onCharacterSelect={select} agentMessages={[]} messages={[]}
    readMessageIds={new Set()} onMessagesRead={()=>{}} content="" actionMessage="" onBack={()=>{}}
    onContentChange={()=>{}} onSend={()=>{}} onSendPrivateChat={()=>false} onSendAll={async()=>({})}
    onStopBulkSend={()=>{}} bulkSending={false} canOperate={false} lockOwner=""
    bulkIntervalRangeMs={{min:2200,max:4500}} onBulkIntervalRangeChange={()=>{}}
    onQueryPresence={query} presenceConnected={true} />
}
createRoot(document.getElementById('root')).render(location.pathname === '/docs' ? <PresenceApiDocs/> : location.pathname === '/characters' ? <CharacterDatabase onQueryPresence={query} presenceConnected={true}/> : <Fixture/>)
`
const bundle = await build({
  stdin: { contents: source + fixture, resolveDir: new URL('../src/routes/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), loader: 'tsx' },
  bundle: true, write: false, outdir:'fixture', format: 'iife', platform: 'browser', jsx: 'automatic',
  alias: { '#': new URL('../src/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' }, logLevel: 'silent',
})
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/^@import.*$/gm, '')
const characters = ['One', 'Two', 'Three'].map((name, i) => ({ id: i+1, characterId: String(i+1), characterName: name, serverId:'1001', serverName:'Test', legionName:'', level:50, className:'Test', faction:'', avatarUrl:'', lastSeenAt:0 }))
const persisted = new Map()
let paginated = true
let writes = 0
let releaseWrite
const firstWriteGate = new Promise(resolve => { releaseWrite = resolve })
const unexpected = []
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text); return }
  if (url.pathname === '/styles.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return }
  if (url.pathname.startsWith('/api/')) {
    response.setHeader('Content-Type','application/json')
    let body = { ok:true, messages:[], statuses:[...persisted.values()], nextCursor:null }
    if (url.pathname === '/api/characters') {
      body = url.searchParams.has('directory')
        ? { ok:true, servers:[{serverId:'1001',serverName:'Test',raceId:1,characterCount:3,unaffiliatedCount:3,legions:[]}] }
        : { ok:true, characters:paginated && !url.searchParams.has('bulk') ? characters.slice(0,2) : characters,
          nextCursor:paginated && !url.searchParams.has('bulk') ? 2 : null, totalCount:3 }
    }
    if (url.pathname === '/api/presence/requests') {
      let raw = ''; for await (const part of request) raw += part
      const requestId = crypto.randomUUID()
      body = {ok:true, query:{ type:'presence_query', requestId, serviceId:'partner',
        requestTopic:'aion2/presence/partner/requests', replyTopic:`aion2/presence/partner/results/${requestId}`,
        expiresAt:Date.now()+180000, characters:JSON.parse(raw).characters }}
    }
    if (url.pathname === '/api/presence/results') {
      let raw = ''; for await (const part of request) raw += part
      const envelope = JSON.parse(raw)
      assert.equal(envelope.agentId, undefined)
      writes++
      if (writes === 1) await firstWriteGate
      for (const result of envelope.results) persisted.set(result.characterId, {
        ...result, online:result.status==='unknown'?null:result.status==='online', sourceId:'partner', updatedAt:Date.now(),
      })
      body = {ok:true,saved:envelope.results.length}
    }
    if (/presence\/(jobs|tasks)/.test(url.pathname)) unexpected.push(url.pathname)
    response.end(JSON.stringify(body)); return
  }
  response.setHeader('Content-Type','text/html')
  response.end('<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({headless:true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome'})
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}})
  page.setDefaultTimeout(10_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const base = `http://127.0.0.1:${server.address().port}`
  await page.goto(base)
  await page.waitForFunction(() => document.querySelectorAll('.presence-dot').length === 2)
  await page.getByRole('button',{name:'查询当前筛选角色在线状态',exact:true}).click()
  await page.waitForFunction(() => window.presenceCommand?.characters.length === 3)
  await page.evaluate(() => window.presenceReply([{serverId:'1001',characterId:'3',status:'online',checkedAt:Date.now()}]))
  await page.waitForSelector('.presence-dot.is-online')
  assert.deepEqual(await page.locator('.character-select-button strong').allTextContents(),['Three','One','Two'],'Off-page online result moves first; remaining order stays stable')
  assert.equal(await page.getByRole('heading',{name:'One',exact:true}).count(),1,'Reordering preserves the selected conversation')
  assert.equal(persisted.size, 0, 'UI must update before HTTP save completes')
  releaseWrite()
  await page.evaluate(() => window.presenceReply([
    {serverId:'1001',characterId:'2',status:'offline',checkedAt:Date.now()},
    {serverId:'1001',characterId:'1',status:'unknown',error:'Service timeout',checkedAt:Date.now()},
  ]))
  await page.getByText('查询完成：3 个角色，失败 1 个，结果已保存。', {exact:true}).waitFor()
  assert.equal(await page.locator('.presence-message').evaluate(element => {
    const message = element.getBoundingClientRect()
    const list = document.querySelector('.character-list').getBoundingClientRect()
    return message.height > 20 && message.bottom <= list.top
  }), true, 'Query progress must have its own visible row')
  assert.equal(await page.locator('.presence-dot.is-online').count(),1)
  assert.equal(await page.locator('.presence-dot.is-offline').count(),1)
  assert.equal(await page.locator('.presence-dot.is-unknown').count(),1)
  const previousRequest=await page.evaluate(()=>window.presenceCommand.requestId)
  await page.getByRole('button',{name:'查询当前筛选角色在线状态',exact:true}).click()
  await page.waitForFunction(previous=>window.presenceCommand.requestId!==previous,previousRequest)
  await page.getByRole('button',{name:'停止在线查询',exact:true}).click()
  await page.getByText(/查询已停止：已返回 0 个角色/).waitFor()
  assert.equal(await page.evaluate(()=>window.presenceListening()),false,'Stop removes MQTT result listener immediately')
  assert.equal(await page.locator('.presence-dot.is-online').count(),1,'Already known online results are retained')
  assert.equal(await page.getByRole('button',{name:'查询当前筛选角色在线状态',exact:true}).isEnabled(),true)
  assert.equal(persisted.size,3)
  assert.deepEqual(await page.locator('.character-select-button strong').allTextContents(),['Three','One','Two'])
  await page.screenshot({path:process.env.TEMP + '/aion2-presence-desktop.png',fullPage:true})
  paginated = false
  await page.reload()
  await page.waitForSelector('.presence-dot.is-online')
  assert.equal(await page.locator('.presence-dot.is-offline').count(),1)
  assert.equal(await page.locator('.presence-dot.is-unknown').count(),1)
  // Age the previously online role and verify it remains ahead of unqueried
  // and offline roles. A freshly online role must still take first place.
  persisted.set('3',{...persisted.get('3'),status:'stale',online:true,checkedAt:Date.now()-240000})
  await page.reload()
  await page.waitForSelector('.presence-dot.is-stale')
  assert.deepEqual(await page.locator('.character-select-button strong').allTextContents(),['Three','One','Two'],'Expired online precedes unknown and offline')
  persisted.set('2',{...persisted.get('2'),status:'online',online:true,checkedAt:Date.now()})
  await page.reload()
  await page.waitForSelector('.presence-dot.is-online')
  assert.deepEqual(await page.locator('.character-select-button strong').allTextContents(),['Two','Three','One'],'Fresh online precedes expired online, then unknown')
  persisted.set('1',{...persisted.get('1'),status:'online',online:true,checkedAt:Date.now()})
  persisted.set('2',{...persisted.get('2'),checkedAt:Date.now()-10000})
  await page.reload()
  await page.waitForFunction(()=>document.querySelectorAll('.presence-dot.is-online').length===2)
  assert.deepEqual(await page.locator('.character-select-button strong').allTextContents(),['One','Two','Three'],'Green online results also sort by most recent query first')
  persisted.set('1',{...persisted.get('1'),status:'unknown',online:null})
  persisted.set('3',{...persisted.get('3'),status:'stale',online:false})
  await page.reload()
  await page.waitForSelector('.presence-dot.is-offline')
  assert.deepEqual(await page.locator('.character-select-button strong').allTextContents(),['Two','One','Three'],'Previously offline stays gray even when old or reported stale by an older API')
  assert.equal(await page.locator('.presence-dot.is-stale').count(),0)
  persisted.set('3',{...persisted.get('3'),online:true})
  persisted.set('1',{...persisted.get('1'),status:'stale',online:true,checkedAt:Date.now()-200000})
  await page.reload()
  await page.waitForFunction(()=>document.querySelectorAll('.presence-dot.is-stale').length===2)
  assert.deepEqual(await page.locator('.character-select-button strong').allTextContents(),['Two','One','Three'],'Current online first, then recently expired before older expired')
  persisted.set('3',{...persisted.get('3'),checkedAt:Date.now()-190000})
  await page.getByRole('button',{name:'刷新可见角色在线状态',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.character-select-button strong')[1]?.textContent==='Three')
  assert.deepEqual(await page.locator('.character-select-button strong').allTextContents(),['Two','Three','One'],'Recently checked expired online comes before older expired online')
  assert.equal(await page.locator('.character-list').evaluate(el=>el.scrollTop),0,'Sorting at the top must not let scroll anchoring move the viewport down')
  await page.goto(base+'/characters')
  await page.getByRole('columnheader',{name:'在线状态',exact:true}).waitFor()
  await page.getByRole('button',{name:'查询当前筛选角色在线状态',exact:true}).click()
  await page.waitForFunction(() => window.presenceCommand?.characters.length === 3)
  assert.equal(await page.evaluate(() => window.presenceCommand.serviceId),'partner')
  await page.evaluate(() => window.presenceReply(window.presenceCommand.characters.map(character=>({...character,status:'online',checkedAt:Date.now()}))))
  await page.getByText('查询完成：3 个角色，失败 0 个，结果已保存。',{exact:true}).waitFor()
  const databaseRequest=await page.evaluate(()=>window.presenceCommand.requestId)
  await page.getByRole('button',{name:'查询当前筛选角色在线状态',exact:true}).click()
  await page.waitForFunction(previous=>window.presenceCommand.requestId!==previous,databaseRequest)
  await page.evaluate(()=>window.presenceReply([{serverId:'1001',characterId:'1',status:'online',checkedAt:Date.now()}]))
  await page.getByRole('button',{name:'停止在线查询',exact:true}).click()
  await page.getByText(/查询已停止：已返回 1 个角色/).waitFor()
  assert.equal(await page.evaluate(()=>window.presenceListening()),false)
  await page.screenshot({path:process.env.TEMP + '/aion2-presence-database-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:process.env.TEMP + '/aion2-presence-database-mobile.png',fullPage:true})
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true,'Database overflow mobile viewport')
  await page.setViewportSize({width:1440,height:1000})
  await page.goto(base+'/docs')
  await page.getByRole('heading',{name:/多客服隔离/}).waitFor()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button',{name:'下载文档',exact:true}).click()
  const download = await downloadEvent
  assert.equal(download.suggestedFilename(),'AION2-presence-provider.md')
  const downloadPath = await download.path()
  assert.equal(readFileSync(downloadPath,'utf8'),readFileSync(new URL('../docs/PRESENCE_PROVIDER.md',import.meta.url),'utf8'))
  await page.getByRole('button',{name:/复制：一批/}).click()
  await page.getByText('示例已复制',{exact:true}).waitFor()
  await page.screenshot({path:process.env.TEMP + '/aion2-presence-docs-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:process.env.TEMP + '/aion2-presence-docs-mobile.png',fullPage:true})
  await page.evaluate(() => window.scrollTo(0,0))
  await page.screenshot({path:process.env.TEMP + '/aion2-presence-docs-mobile-top.png'})
  await page.locator('#provider-request').scrollIntoViewIfNeeded()
  await page.screenshot({path:process.env.TEMP + '/aion2-presence-docs-mobile-fields.png'})
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true,'Docs overflow mobile viewport')
  assert.deepEqual(errors,[])
  assert.deepEqual(unexpected,[])
  console.log('PASS: independent service without chat lock, database query entry, immediate updates, persistence, reload, responsive docs, no legacy task polling')
} finally {
  releaseWrite()
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
