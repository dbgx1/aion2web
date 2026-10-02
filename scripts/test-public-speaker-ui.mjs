import assert from 'node:assert/strict'
import {readFileSync,mkdirSync} from 'node:fs'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const root=process.cwd().replaceAll('\\','/')+'/'
const source=readFileSync('src/routes/index.tsx','utf8')
const fixture=`
import {createRoot} from 'react-dom/client'
const pub=(name,id='619807898717071672')=>({id:name,type:'chat_message',agentId:'test',title:name,content:'Hello',time:new Date().toISOString(),raw:{direction:'S->C',payload:{jsonData:{isFromGame:true}},chat_meta:{sender:name,senderCharacterId:id,serverId:'2201',roomType:'WORLD'}}})
function Fixture(){
 const [selected,select]=useState(),[events,setEvents]=useState([pub('coconiv')])
 window.events=setEvents;window.pub=pub; window.sent=0
 return <TrackingProvider><MessageCenter agent={{agentId:'test',serverId:'2202',host:'Test'}} selectedCharacter={selected} onCharacterSelect={select}
 agentMessages={events} messages={[]} readMessageIds={new Set()} onMessagesRead={()=>{}} content="" onContentChange={()=>{}}
 actionMessage="" onBack={()=>{}} onSend={()=>window.sent++} onSendPrivateChat={async()=>({})} onSendAll={async()=>({})}
 onSendFaction={async()=>{window.sent++;return {}}} onStopBulkSend={()=>{}} bulkSending={false} canOperate={true}
 bulkIntervalRangeMs={{min:1000,max:1000}} onBulkIntervalRangeChange={()=>{}} presenceConnected={false} onQueryPresence={async()=>{}}/></TrackingProvider>
}createRoot(document.getElementById('root')).render(<Fixture/>);`
const bundle=await build({stdin:{contents:source+fixture,loader:'tsx',resolveDir:root+'src/routes'},bundle:true,write:false,outdir:'fixture',platform:'browser',format:'iife',jsx:'automatic',loader:{'.md':'text'},alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'},logLevel:'silent'})
const stored=new Map(),posts=[],profileReads=[]
const base={id:1,characterId:'111',characterName:'Base',serverId:'2202',serverName:'Zikel',level:1,legionName:'',className:''}
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');let body={ok:true,entries:[],messages:[],statuses:[]}
 if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text);return}
 if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end(readFileSync('src/styles.css'));return}
 if(url.pathname==='/api/characters'){
  if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;const data=JSON.parse(raw);posts.push(data);if(data.characterName==='StoreFailure'){res.statusCode=503;body={ok:false,error:'角色保存失败，请重试'}}else{stored.set(data.characterId,{...base,...data,id:2,serverName:'Israphel'});body={ok:true,created:true,character:stored.get(data.characterId)}}}
  else if(url.searchParams.has('directory'))body={ok:true,servers:[{serverId:'2202',serverName:'Zikel',raceId:2,characterCount:stored.size+1,unaffiliatedCount:stored.size+1,legions:[]}]}
  else {const id=url.searchParams.get('characterId'),name=url.searchParams.get('characterName');body={ok:true,characters:id?[...stored.values()].filter(c=>c.characterId===id):name?[...stored.values()].filter(c=>c.characterName===name):[base,...stored.values()],totalCount:stored.size+1,nextCursor:null}}
 }
 if(url.pathname==='/api/characters/profile'){profileReads.push(Object.fromEntries(url.searchParams));body={ok:true,profile:null}}
 if(url.pathname==='/api/messages')body={ok:true,nextCursor:null,messages:Array.from({length:60},(_,i)=>({id:i+1,sourceMessageId:'history-'+i,agentId:'test',messageType:'chat_message',content:'历史私聊消息 '+i,direction:'incoming',requestId:'',sentAt:1700000000000+i*1000}))}
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return}
 res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'})
try{
 const page=await browser.newPage({viewport:{width:1400,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByRole('tab',{name:'公频',exact:true}).click()
 await page.getByLabel('阵营消息').fill('保留公屏草稿')
 await page.getByRole('button',{name:'查询角色资料：coconiv',exact:true}).click()
 await page.getByRole('heading',{name:'官网角色资料',exact:true}).waitFor()
 await page.getByText('未找到该角色',{exact:false}).waitFor()
 assert.equal(profileReads[0].serverId,'2201');assert.equal(profileReads[0].characterName,'coconiv')
 assert.equal(posts.length,0,'Profile lookup does not create a database record')
 assert.equal(await page.getByRole('tab',{name:'公频',exact:true}).getAttribute('aria-selected'),'true')
 await page.getByRole('button',{name:'关闭角色资料',exact:true}).click()
 await page.getByRole('button',{name:'私聊 coconiv',exact:true}).click()
 await page.getByRole('heading',{name:'coconiv',exact:true}).waitFor()
 assert.match(await page.locator('.chat-header').innerText(),/Israphel/,'Cross-server public speakers retain their actual recipient server')
 assert.equal(posts.length,1,'Opening a new private chat first adds the speaker to the database')
 assert.equal(await page.evaluate(()=>window.sent),0)
 await page.getByRole('button',{name:'返回公屏',exact:true}).click()
 assert.equal(await page.getByLabel('阵营消息').inputValue(),'保留公屏草稿')
 assert.equal(await page.getByRole('button',{name:/加入角色数据库/}).count(),0)
 assert.equal(posts.length,1);assert.equal(posts[0].characterId,'619807898717071672');assert.equal(posts[0].serverId,'2201')
 await page.getByRole('button',{name:'私聊 coconiv',exact:true}).click();await page.getByRole('button',{name:'返回公屏',exact:true}).click()
 assert.equal(posts.length,1,'Already stored speakers are not uploaded again')
 mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/public-player-desktop.png'})
 await page.evaluate(()=>window.events([window.pub('Missing','')]))
 await page.getByRole('button',{name:'私聊 Missing',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'消息缺少角色 ID'}).waitFor();assert.equal(posts.length,1)
 await page.getByRole('button',{name:'查询角色资料：Missing',exact:true}).click()
 await page.getByText('未找到该角色',{exact:false}).waitFor()
 assert.equal(profileReads.at(-1).characterName,'Missing','Official lookup works with name and server even without a game ID')
 await page.getByRole('button',{name:'关闭角色资料',exact:true}).click()
 await page.evaluate(()=>window.events([window.pub('StoreFailure','999')]))
 await page.getByRole('button',{name:'私聊 StoreFailure',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'角色保存失败'}).waitFor()
 assert.equal(await page.getByRole('heading',{name:'公频消息',exact:true}).isVisible(),true,'Failed persistence keeps the user on the public message and explains why')
 assert.equal(stored.has('999'),false)
 await page.evaluate(()=>window.events([window.pub('coconiv','')]))
 await page.getByRole('button',{name:'私聊 coconiv',exact:true}).click();await page.getByRole('heading',{name:'coconiv',exact:true}).waitFor()
 await page.getByRole('button',{name:'返回公屏',exact:true}).click()
 await page.setViewportSize({width:390,height:844})
 await page.screenshot({path:'artifacts/public-player-mobile.png'})
 assert.equal(await page.getByRole('button',{name:'私聊 coconiv',exact:true}).isVisible(),true)
 // Exercise the actual MessageCenter wiring, not only the reusable scroll hook.
 await page.setViewportSize({width:1400,height:900})
 await page.evaluate(()=>window.events(Array.from({length:80},(_,i)=>window.pub('player-'+i))))
 const thread=page.locator('.public-message-thread')
 await page.waitForFunction(()=>{const e=document.querySelector('.public-message-thread');return e&&e.scrollHeight>e.clientHeight&&e.scrollHeight-e.clientHeight-e.scrollTop<2})
 const before=await thread.evaluate(e=>e.scrollTop)
 await thread.hover();await page.mouse.wheel(0,-700)
 await page.waitForFunction(before=>document.querySelector('.public-message-thread').scrollTop<before-100,before)
 const held=await thread.evaluate(e=>e.scrollTop)
 await page.evaluate(()=>window.events(old=>[...old,window.pub('new-1'),window.pub('new-2')]))
 await page.getByRole('button',{name:'2 条新消息，回到最新消息',exact:true}).waitFor()
 assert.ok(Math.abs(await thread.evaluate(e=>e.scrollTop)-held)<2,'real public screen holds reading position')
 await page.getByRole('tab',{name:'私聊',exact:true}).click()
 await page.waitForFunction(()=>{const e=document.querySelector('[aria-label="私聊消息记录"]');return e&&e.scrollHeight>e.clientHeight&&e.scrollHeight-e.clientHeight-e.scrollTop<2})
 const privateThread=page.getByLabel('私聊消息记录'),privateBefore=await privateThread.evaluate(e=>e.scrollTop)
 await privateThread.hover();await page.mouse.wheel(0,-650)
 await page.waitForFunction(before=>document.querySelector('[aria-label="私聊消息记录"]').scrollTop<before-100,privateBefore)
 const privateHeld=await privateThread.evaluate(e=>e.scrollTop)
 await page.getByRole('tab',{name:'公频',exact:true}).click()
 assert.ok(Math.abs(await thread.evaluate(e=>e.scrollTop)-held)<2,'public position survives private view')
 await page.getByRole('tab',{name:'私聊',exact:true}).click()
 assert.ok(Math.abs(await privateThread.evaluate(e=>e.scrollTop)-privateHeld)<2,'private position survives public view')
 await page.getByRole('tab',{name:'公频',exact:true}).click()
 await page.screenshot({path:'artifacts/chat-scroll-message-center.png'})
 await page.getByRole('button',{name:'2 条新消息，回到最新消息',exact:true}).click()
 await page.waitForFunction(()=>!document.querySelector('.chat-scroll-notice'))
 assert.ok(await thread.evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop)<2)
 assert.deepEqual(errors,[]);console.log('PASS: public speaker private chat, no auto-send, return preserves draft, save and duplicate, exact-name fallback, missing identity and mobile actions')
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
