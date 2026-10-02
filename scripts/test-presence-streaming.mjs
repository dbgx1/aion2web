import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import {createRoot} from 'react-dom/client'
  import {usePresenceQuery} from './src/lib/use-presence-query'
  import {useCharacterDirectory} from './src/lib/use-character-directory'
  function Fixture() {
    const directory = useCharacterDirectory()
    const api = usePresenceQuery(async (targets, receive, signal) => {
      window.calls.push(targets)
      await new Promise((resolve, reject) => {
        window.answer = () => {
          receive({type:'presence_result',requestId:'test',results:targets.map(c=>({...c,status:'online',checkedAt:Date.now()}))})
          resolve()
        }
        signal.addEventListener('abort',()=>reject(new Error('stopped')),{once:true})
      })
    })
    window.calls ||= []
    window.start = () => api.runQuery(async signal => (async function*(){
      for await (const page of directory.streamAll(signal, 50)) yield page.map(c=>({serverId:c.serverKey,characterId:c.characterId}))
    })())
    window.stop = api.stopQuery
    return <output>{api.presenceMessage}</output>
  }
  createRoot(document.getElementById('root')).render(<Fixture/>)
` }, bundle:true, write:false, platform:'browser', format:'iife', jsx:'automatic',
  alias:{'#':new URL('../src/',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')},
  define:{'process.env.NODE_ENV':'"production"'}, logLevel:'silent' })
const reads = [], saved = []
const character = id => ({id,characterId:String(id),characterName:'Role '+id,serverId:'2201',serverName:'Test',legionName:'',className:'',level:1})
const server = createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost')
  if (url.pathname === '/bundle.js') {res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}
  if (url.pathname.startsWith('/api/')) {
    let result = {ok:true}
    if (url.pathname === '/api/characters') {
      if (url.searchParams.has('directory')) result.servers=[{serverId:'2201',serverName:'Test',raceId:2,characterCount:3,unaffiliatedCount:3,legions:[]}]
      else if (url.searchParams.has('bulk')) {
        reads.push(Number(url.searchParams.get('cursor')))
        assert.equal(url.searchParams.get('limit'),'50')
        const first = !Number(url.searchParams.get('cursor'))
        result={ok:true,characters:first?[character(1),character(2)]:[character(2),character(3)],nextCursor:first?2:null,totalCount:null}
      } else result={ok:true,characters:[character(1)],nextCursor:null,totalCount:3}
    }
    if (url.pathname === '/api/presence/results') {
      let body=''; for await(const part of req) body+=part
      saved.push(JSON.parse(body))
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return
  }
  res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser = await chromium.launch({headless:true,channel:'msedge'})
try {
  const page=await browser.newPage();page.setDefaultTimeout(10000)
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForResponse(r=>r.url().includes('/api/characters?')&&!r.url().includes('directory'))
  await page.evaluate(()=>{window.outcome=window.start()})
  await page.waitForFunction(()=>window.calls.length===1)
  assert.deepEqual(reads,[0],'first game query starts before subsequent directory pages are downloaded')
  await page.evaluate(()=>window.answer())
  await page.waitForFunction(()=>window.calls.length===2)
  assert.equal(saved.length,1,'first results are saved before advancing')
  assert.deepEqual(await page.evaluate(()=>window.calls[1].map(c=>c.characterId)),['3'],'cross-page duplicates are queried once')
  await page.evaluate(()=>window.answer())
  assert.equal(await page.evaluate(()=>window.outcome),'complete')
  await page.getByText('查询完成：3 个角色，失败 0 个，结果已保存。',{exact:true}).waitFor()
  reads.length=0
  await page.evaluate(()=>{window.outcome=window.start()})
  await page.waitForFunction(()=>window.calls.length===3)
  await page.evaluate(()=>window.stop())
  assert.equal(await page.evaluate(()=>window.outcome),'aborted')
  assert.deepEqual(reads,[0],'stop prevents fetching and querying later pages')
  assert.deepEqual(errors,[])
  console.log('PASS: directory pages stream into queries; incremental save; cross-page deduplication; stop cancels further page loading')
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
