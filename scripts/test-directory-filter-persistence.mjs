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
function Directory({scope}) {
 const d = useCharacterDirectory(scope);
 return <div><output>{JSON.stringify([d.selectedRaceId,d.selectedServerKey,d.selectedLegionName])}</output>
 <button onClick={()=>d.selectRace('2')}>race</button><button onClick={()=>d.selectServer('2001')}>server</button>
 <button onClick={()=>d.selectLegion('测试军团')}>legion</button><button onClick={()=>d.selectLegion('__none__')}>none</button>
 <button onClick={()=>d.selectRace('1')}>change race</button><span>{d.loading?'loading':'ready'}</span></div>
}
function App(){ const [visible,setVisible]=useState(true),[scope,setScope]=useState('test:admin:messages');
 return <><button onClick={()=>setVisible(v=>!v)}>navigate</button>
 <button onClick={()=>setScope('test:admin:characters')}>other page</button>
 <button onClick={()=>setScope('test:agent:messages')}>other account</button>
 <button onClick={()=>setScope('test:admin:messages')}>messages</button>{visible&&<Directory scope={scope}/>}</>
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
  await page.evaluate(()=>localStorage.setItem('test:admin:messages','{broken'))
  await page.reload(); await state(['0','__all__',null])
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('disabled')}})
  await click('race'); await click('server'); await state(['2','2001',null])
  assert.deepEqual(errors,[])
  console.log('PASS: actual directory hook persists on remount/reload, isolates accounts and pages, restores before fetching, keeps same-selection dependents, saves reset/no-legion, handles corrupt/disabled storage')
} finally { await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve)) }
