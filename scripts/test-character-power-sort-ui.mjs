import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const fixture = `import {createRoot} from 'react-dom/client'; createRoot(document.getElementById('root')).render(<TrackingProvider><CharacterDatabase filterStorageKey="sort-ui" onQueryPresence={async()=>{}} presenceConnected={false}/></TrackingProvider>);`
const bundle = await build({ stdin: { contents: readFileSync('src/routes/index.tsx', 'utf8') + fixture, resolveDir: root+'src/routes', loader: 'tsx' }, bundle: true, write: false, outdir: 'fixture', platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '#': root+'src' }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' }, logLevel: 'silent' })
const requests = []
const server = createServer((req,res) => {
  const url = new URL(req.url,'http://localhost')
  if (url.pathname === '/bundle.js') { res.setHeader('Content-Type','text/javascript'); res.end(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text); return }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type','text/css'); res.end(readFileSync('src/styles.css')); return }
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type','application/json')
    const sort=url.searchParams.get('sort')
    requests.push(url.searchParams)
    const ids=sort==='power_desc'?[2,1,3]:[1,2,3]
    res.end(JSON.stringify({ok:true,entries:[],servers:[],totalCount:3,nextCursor:null,characters:ids.map(id=>({id,characterId:String(id),characterName:'角色 '+id,serverId:'1001',legionName:'测试军团',faction:'天族',className:'剑星',level:50,avatarUrl:'',legionPosition:id===2?0:2,combatPower:id===3?null:id*10000,lastSeenAt:Date.now()}))})); return
  }
  res.setHeader('Content-Type','text/html'); res.end('<html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><body style="padding:20px"><div id="root"></div><script src="/bundle.js"></script></body></html>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:'msedge'})
try {
  const page=await browser.newPage({viewport:{width:1400,height:900}}), errors=[]
  page.on('pageerror',e=>{errors.push(e.message); console.error(e.message)})
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.locator('tbody tr').first().waitFor()
  const select=page.getByRole('combobox',{name:'战力排序'})
  await select.selectOption('power_desc')
  await page.waitForFunction(()=>document.querySelector('tbody tr td code')?.textContent==='2')
  assert.equal(requests.at(-1).get('sort'),'power_desc')
  await page.reload()
  await page.waitForFunction(()=>document.querySelector('tbody tr td code')?.textContent==='2')
  assert.equal(await select.inputValue(),'power_desc')
  mkdirSync('artifacts',{recursive:true})
  await page.screenshot({path:'artifacts/character-power-sort-desktop.png'})
  await select.selectOption('power_asc')
  await page.waitForFunction(()=>document.querySelector('tbody tr td code')?.textContent==='1')
  assert.equal(requests.at(-1).get('sort'),'power_asc')
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:'artifacts/character-power-sort-mobile.png'})
  const box=await select.boundingBox()
  assert.ok(box.x>=0 && box.x+box.width<=390,'Sorting control stays within mobile viewport')
  const resetResponse=page.waitForResponse(r=>r.url().includes('/api/characters?')&&!r.url().includes('sort='))
  await select.selectOption('default'); await resetResponse
  assert.deepEqual(errors,[])
  console.log('PASS: database sorting controls, requests, restored selection, desktop and mobile layout')
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)) }

