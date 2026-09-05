import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import {build} from 'esbuild'

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const root=new URL('../',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')
const bundle=await build({stdin:{contents:`
 import {useState,useEffect} from 'react'
 import {createRoot} from 'react-dom/client'
 import {useUnreadCharacters} from '#/lib/use-unread-characters'
 import {toGameCharacter} from '#/lib/use-character-directory'
 function Fixture(){
  const [targets,setTargets]=useState([]),[known,setKnown]=useState([])
  const api=useUnreadCharacters(targets,known)
  useEffect(()=>{window.api={...api,setTargets,setKnown:rows=>setKnown(rows.map(toGameCharacter))}})
  return <div>{api.characters.map(c=><p key={c.id}>{c.name}</p>)}</div>
 }
 createRoot(document.getElementById('root')).render(<Fixture/>);
`,loader:'tsx',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const server=createServer((req,res)=>{
 res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html')
 res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'})
try{
 const page=await browser.newPage(),errors=[],requests=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/api/characters?**',route=>{requests.push(route)})
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.waitForFunction(()=>window.api)
 const row={id:1,characterId:'1',characterName:'Known role',serverId:'1001',level:1}
 const knownTarget={characterId:'1',targetName:'old name',serverKey:'1001'}
 await page.evaluate(({row,target})=>{window.api.setKnown([row]);window.api.setTargets([target])},{row,target:knownTarget})
 await page.getByText('Known role',{exact:true}).waitFor()
 assert.equal(requests.length,0,'A fully scoped known ID needs no Cloudflare lookup')
 const targets=[{characterId:'2',targetName:'Fallback',serverKey:'1001'},{characterId:'3',targetName:'Third',serverKey:'1001'}]
 await page.evaluate(targets=>window.api.setTargets(targets),targets)
 await page.waitForFunction(()=>window.api.loading)
 // Wait for both network requests without adding an arbitrary delay.
 while(requests.length<2)await new Promise(resolve=>setTimeout(resolve,10))
 await page.evaluate(targets=>window.api.setTargets([...targets].reverse()),targets)
 await page.waitForFunction(()=>window.api.characters[0].characterId==='3')
 for(const route of requests)await route.fulfill({json:{ok:true,characters:[]}})
 await page.waitForFunction(()=>!window.api.loading)
 assert.equal(requests.length,2,'Reordering unread rows must not restart in-flight lookups')
 await page.evaluate(row=>window.api.setKnown([{...row,id:2,characterId:'2',characterName:'Resolved name'}]),row)
 await page.getByText('Resolved name',{exact:true}).waitFor()
 assert.equal(requests.length,2,'A negative cache entry must yield to a newly loaded exact identity')
 await page.evaluate(row=>{
  window.api.setKnown([row]);window.api.setTargets([{characterId:'',targetName:'Known role',serverKey:''}])
 },row)
 while(requests.length<3)await new Promise(resolve=>setTimeout(resolve,10))
 await requests[2].fulfill({json:{ok:true,characters:[row,{...row,id:9,serverId:'2001'}]}})
 await page.waitForFunction(()=>!window.api.loading)
 assert.equal(await page.evaluate(()=>window.api.characters[0].characterId),'','An ambiguous name cannot borrow a partial directory match')
 assert.deepEqual(errors,[])
 console.log('PASS: known unread identities avoid lookups, reordering preserves in-flight requests, fallback cache refreshes, ambiguous names stay unresolved')
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
