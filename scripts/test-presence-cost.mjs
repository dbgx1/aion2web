import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import {createRoot} from 'react-dom/client'
  import {useState} from 'react'
  import {usePresenceQuery} from './src/lib/use-presence-query'
  function Fixture(){
    const [lookups,setLookups]=useState([{serverId:'1001',characterId:'1'}])
    const api=usePresenceQuery(async (targets,receive)=>receive({type:'presence_result',requestId:'test',results:targets.map(c=>({...c,status:'online',checkedAt:Date.now()}))}),lookups)
    window.api=api; window.changeRole=()=>setLookups([{serverId:'1001',characterId:String(Math.random())}])
    return <output>{JSON.stringify({loading:api.presenceLoading,queueing:api.presenceQueueing,message:api.presenceMessage})}</output>
  }
  createRoot(document.getElementById('root')).render(<Fixture/>)
`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  alias:{'#':new URL('../src/',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')},
  define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const server=createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html')
  res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'})
try{
  const page=await browser.newPage()
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.clock.install()
  await page.addInitScript(()=>{
    window.retryDelays=[]
    const schedule=window.setTimeout.bind(window)
    window.setTimeout=(callback,delay,...args)=>{
      if(delay===1000||delay===2000) window.retryDelays.push(delay)
      return schedule(callback,delay,...args)
    }
  })
  let reads=0,status=503,writes=0,saveStatus=400
  await page.route('**/api/presence/status',route=>{reads++;return route.fulfill({status,json:status===200?{ok:true,statuses:[]}:{error:'temporary'}})})
  await page.route('**/api/presence/results',route=>{writes++;return route.fulfill({status:saveStatus,json:{ok:saveStatus===200,error:'save failure'}})})
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(()=>window.api)
  await page.clock.runFor(250)
  await page.waitForFunction(()=>!window.api.presenceLoading)
  assert.equal(reads,1)
  for(let i=0;i<5;i++){
    await page.evaluate(()=>window.changeRole())
    await page.clock.runFor(1000)
  }
  assert.equal(reads,1,'Scrolling/remounting the query effect cannot bypass error backoff')
  status=200
  await page.clock.runFor(21000)
  await page.waitForFunction(()=>!window.api.presenceLoading)
  assert.equal(reads,2,'Retry resumes after the cooldown')
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false})
  })
  const beforeOffline=reads
  await page.clock.runFor(60000)
  assert.equal(reads,beforeOffline,'Offline browser must not poll the API')
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true})
    window.dispatchEvent(new Event('online'))
  })
  await page.waitForFunction(()=>!window.api.presenceLoading)
  assert.equal(reads,beforeOffline+1)

  const query=()=>page.evaluate(()=>{void window.api.runQuery(async()=>[{serverId:'1001',characterId:'1'}])})
  await query()
  await page.waitForFunction(()=>!window.api.presenceQueueing&&window.api.presenceMessage.includes('未保存'))
  assert.equal(writes,1,'A permanent 400 must not trigger three identical save requests')
  saveStatus=503
  const failedSave=page.waitForResponse(r=>r.url().endsWith('/api/presence/results'))
  await query()
  await failedSave
  await page.waitForFunction(()=>window.retryDelays.includes(1000))
  const first=writes
  await page.clock.runFor(500)
  assert.equal(writes,first,'Retries must not immediately hammer the server')
  const secondSave=page.waitForResponse(r=>r.url().endsWith('/api/presence/results'))
  await page.clock.runFor(600)
  await secondSave
  assert.equal(writes,first+1)
  await page.waitForFunction(()=>window.retryDelays.includes(2000))
  await page.clock.runFor(2100)
  await page.waitForFunction(()=>!window.api.presenceQueueing)
  assert.equal(writes,first+2,'Transient saves retry at most three times')
  // The green-to-yellow transition must happen locally even without network.
  saveStatus=200
  await query()
  await page.waitForFunction(()=>!window.api.presenceQueueing)
  const checkedAt=await page.evaluate(()=>window.api.presenceByCharacter.get('1001\u00001').checkedAt)
  await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}))
  const readsBeforeExpiry=reads
  const untilBoundary=await page.evaluate(checkedAt=>checkedAt+180000-Date.now(),checkedAt)
  await page.clock.runFor(untilBoundary)
  assert.equal(await page.evaluate(()=>window.api.presenceByCharacter.get('1001\u00001').status),'online')
  await page.clock.runFor(2)
  await page.waitForFunction(()=>window.api.presenceByCharacter.get('1001\u00001').status==='stale')
  assert.equal(reads,readsBeforeExpiry,'Expiration adds no API requests')
  assert.deepEqual(errors,[])
  console.log('PASS: presence poll backoff survives scrolling; offline pauses; wake refreshes; permanent saves stop; transient retries are delayed and bounded')
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
