import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const fixture = `
import { useState } from 'react'; import { createRoot } from 'react-dom/client';
import { useCharacterDirectory } from './src/lib/use-character-directory';
function Directory({scope,client}) {
 const d = useCharacterDirectory(scope,client);
 return <div><output>{JSON.stringify([d.selectedRaceId,d.selectedServerKey,d.selectedLegionName])}</output>
 <button onClick={()=>d.selectRace('2')}>race</button><button onClick={()=>d.selectServer('2001')}>server</button>
 <button onClick={()=>d.selectLegion('测试军团')}>legion</button><button onClick={()=>d.selectLegion('__none__')}>none</button>
 <button onClick={()=>d.setLegionLeadersOnly(!d.legionLeadersOnly)}>leaders</button>
 <button onClick={()=>d.selectServer('__all__')}>all servers</button><button onClick={()=>d.loadAll()}>bulk</button><i>{String(d.legionLeadersOnly)}</i>
 <button onClick={()=>d.setSort('power_desc')}>sort power</button><b>{d.sort}</b>
 <button onClick={()=>d.selectRace('1')}>change race</button><span>{d.loading?'loading':'ready'}</span></div>
}
function App(){ const [visible,setVisible]=useState(true),[scope,setScope]=useState('test:admin:messages'),[client,setClient]=useState();
 return <><button onClick={()=>setVisible(v=>!v)}>navigate</button>
 <button onClick={()=>setScope('test:admin:characters')}>other page</button>
 <button onClick={()=>setScope('test:agent:messages')}>other account</button>
 <button onClick={()=>setScope('test:admin:messages')}>messages</button>
 <button onClick={()=>setClient({key:'a',serverId:'2201'})}>client a</button>
 <button onClick={()=>setClient({key:'b',serverId:'1305'})}>client b</button>
 <button onClick={()=>setClient({key:'b',serverId:'2301'})}>client switched server</button>
 <button onClick={()=>setClient({key:'new'})}>unidentified client</button>
 <button onClick={()=>setClient({key:'new',serverId:'1003'})}>identified client</button>
 {visible&&<Directory scope={scope} client={client}/>}</>
} createRoot(document.getElementById('root')).render(<App/>);`
const bundle = await build({ stdin: { contents: fixture, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '#': root + 'src' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const requests = []
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type','text/javascript'); res.end(bundle.outputFiles[0].text); return }
  if (req.url.startsWith('/api/characters')) {
    const params = new URL(req.url,'http://localhost').searchParams
    res.setHeader('Content-Type','application/json')
    if (params.has('directory')) res.end(JSON.stringify({ok:true,servers:[]}))
    else { requests.push(params); res.end(JSON.stringify({ok:true,characters:[],nextCursor:null,totalCount:0})) }
    return
  }
  res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser = await chromium.launch({headless:true,channel:'msedge'})
try {
  const page=await browser.newPage(), errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  const url=`http://127.0.0.1:${server.address().port}`
  await page.goto(url)
  const click = name => page.getByRole('button',{name,exact:true}).click()
  const state = async expected => { await page.waitForFunction(value=>document.querySelector('output')?.textContent===JSON.stringify(value),expected); await page.getByText('ready',{exact:true}).waitFor() }
  await click('race'); await click('server'); await click('legion')
  await state(['2','2001','测试军团'])
  await click('navigate'); const before=requests.length; await click('navigate')
  await state(['2','2001','测试军团'])
  assert.equal(requests.length,before+1,'restore must not issue a default unfiltered query')
  assert.equal(requests.at(-1).get('legionName'),'测试军团')
  await page.reload(); await state(['2','2001','测试军团'])
  await click('race'); await click('server'); await state(['2','2001','测试军团'])
  await click('other page'); await state(['0','__all__',null])
  await click('other account'); await state(['0','__all__',null])
  await click('messages'); await state(['2','2001','测试军团'])
  await click('none'); await state(['2','2001','__none__'])
  await page.reload(); await state(['2','2001','__none__'])
  assert.equal(requests.at(-1).get('withoutLegion'),'1')
  await click('change race'); await state(['1','__all__',null])
  await page.reload(); await state(['1','__all__',null])
  assert.equal(await page.locator('i').textContent(),'false','Old saved filters default to all roles')
  const leadersResponse=page.waitForResponse(r=>r.url().includes('/api/characters?')&&r.url().includes('legionLeadersOnly=1'))
  await click('leaders'); await leadersResponse
  await page.reload(); await state(['1','__all__',null])
  assert.equal(await page.locator('i').textContent(),'true')
  assert.equal(requests.at(-1).get('legionLeadersOnly'),'1')
  const bulkResponse=page.waitForResponse(r=>r.url().includes('bulk=1'))
  await click('bulk'); await bulkResponse
  assert.equal(requests.at(-1).get('bulk'),'1')
  assert.equal(requests.at(-1).get('legionLeadersOnly'),'1')
  await click('other page'); await state(['0','__all__',null])
  assert.equal(await page.locator('i').textContent(),'false')
  await click('messages'); await state(['1','__all__',null])
  assert.equal(await page.locator('i').textContent(),'true')
  const allResponse=page.waitForResponse(r=>r.url().includes('/api/characters?')&&!r.url().includes('legionLeadersOnly'))
  await click('leaders'); await allResponse
  assert.equal(requests.at(-1).has('legionLeadersOnly'),false)
  const sortResponse=page.waitForResponse(r=>r.url().includes('sort=power_desc'))
  await click('sort power'); await sortResponse
  await page.reload(); await state(['1','__all__',null])
  assert.equal(await page.locator('b').textContent(),'power_desc')
  assert.equal(requests.at(-1).get('sort'),'power_desc')
  const sortedBulk=page.waitForResponse(r=>r.url().includes('bulk=1'))
  await click('bulk'); await sortedBulk
  assert.equal(requests.at(-1).get('sort'),'power_desc')
  await click('other page'); await state(['0','__all__',null])
  assert.equal(await page.locator('b').textContent(),'default')
  await click('messages'); await state(['1','__all__',null])
  await page.evaluate(()=>localStorage.setItem('test:admin:messages','{broken'))
  await page.reload(); await state(['0','__all__',null])
  const clientResponse=page.waitForResponse(r=>r.url().includes('serverId=2201'))
  await click('client a'); await clientResponse; await state(['0','2201',null])
  assert.equal(requests.at(-1).get('serverId'),'2201')
  await click('all servers'); await state(['0','__all__',null])
  await click('navigate'); const beforeClientReentry=requests.length
  const reentryResponse=page.waitForResponse(r=>r.url().includes('serverId=2201'))
  await click('navigate'); await reentryResponse
  await state(['0','2201',null])
  assert.equal(requests.length,beforeClientReentry+1,'client entry fetches only its own server, without a transient all-server request')
  await click('client b'); await state(['0','1305',null])
  await click('client switched server'); await state(['0','2301',null])
  await click('unidentified client'); await state(['0','__all__',null])
  const identifiedResponse=page.waitForResponse(r=>r.url().includes('serverId=1003'))
  await click('identified client'); await identifiedResponse; await state(['0','1003',null])
  assert.equal(requests.at(-1).get('serverId'),'1003','legacy/noncatalog server IDs are preserved')
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('disabled')}})
  await click('race'); await click('server'); await state(['2','2001',null])
  assert.deepEqual(errors,[])
  console.log('PASS: actual directory hook persists on remount/reload, isolates accounts and pages, restores before fetching, keeps same-selection dependents, saves reset/no-legion, handles corrupt/disabled storage')
} finally { await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve)) }
