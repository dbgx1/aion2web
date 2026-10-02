import assert from 'node:assert/strict'
import {readFileSync, mkdirSync} from 'node:fs'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const root=process.cwd().replaceAll('\\','/')+'/'
const fixture=`
import {useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {useChatScroll} from '#/lib/use-chat-scroll'
import {ChatScrollNotice} from '#/components/chat-scroll-notice'
const initial=()=>Array.from({length:80},(_,i)=>({id:'m'+i,time:new Date(1700000000000+i*1000).toISOString(),content:'消息 '+i+' · 正在阅读的内容应保持原位'}))
function Fixture(){
 const [scope,setScope]=useState('public'),[messages,setMessages]=useState(initial),[height,setHeight]=useState(410)
 const ref=useRef(null), scroll=useChatScroll(ref,scope,true,messages)
 window.append=(n=1)=>setMessages(old=>[...old,...Array.from({length:n},(_,i)=>({id:'m'+(Number(old.at(-1).id.slice(1))+i+1),time:new Date(Date.parse(old.at(-1).time)+(i+1)*1000).toISOString(),content:'新消息 '+i}))])
 window.prepend=()=>setMessages(old=>[...Array.from({length:20},(_,i)=>({id:'old'+i,time:new Date(1600000000000+i*1000).toISOString(),content:'历史消息 '+i})),...old])
 window.rewrite=()=>setMessages(old=>old.map((m,i)=>i===3?{...m,content:'翻译后变高的消息 '.repeat(100)}:m))
 window.trim=()=>setMessages(old=>old.slice(5))
 window.setScope=setScope;window.setHeight=setHeight
 return <><button onClick={()=>setScope(scope==='public'?'private':'public')}>切换会话</button>
 <div className="chat-pane" style={{height:height+110,maxWidth:650,margin:'24px auto'}}><header className="chat-header">{scope==='public'?'公屏消息':'私聊消息'}</header>
 <div className="chat-thread-viewport"><div ref={ref} className="chat-thread" aria-label="消息记录" tabIndex={0}>
 {messages.map(m=><article data-chat-id={m.id} key={m.id} className="chat-message"><div><span className="chat-message-meta">玩家</span><p>{m.content}</p></div></article>)}
 </div><ChatScrollNotice paused={scroll.paused} unread={scroll.unread} onLatest={scroll.jumpToLatest}/></div>
 <form className="chat-composer" onSubmit={e=>{e.preventDefault();scroll.jumpToLatest();window.append()}}><button>发送</button></form></div></>
}createRoot(document.getElementById('root')).render(<Fixture/>);`
const bundle=await build({stdin:{contents:fixture,loader:'tsx',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'#':root+'src'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const server=createServer((req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}
 if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(readFileSync('src/styles.css'));return}
 res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>')
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({headless:true,channel:'msedge'})
try{
 const page=await browser.newPage({viewport:{width:1000,height:900}}), errors=[]
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)})
 await page.goto('http://127.0.0.1:'+server.address().port)
 await page.locator('.chat-thread').waitFor({timeout:5000})
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
 const pos=()=>page.locator('.chat-thread').evaluate(e=>({top:e.scrollTop,gap:e.scrollHeight-e.clientHeight-e.scrollTop}))
 const up=async amount=>{const before=(await pos()).top;await page.locator('.chat-thread').hover();await page.mouse.wheel(0,-amount);await page.waitForFunction(before=>document.querySelector('.chat-thread').scrollTop<before-50,before);await settle()}
 const anchor=()=>page.locator('.chat-thread').evaluate(e=>{const top=e.getBoundingClientRect().top;const row=[...e.querySelectorAll('[data-chat-id]')].find(r=>r.getBoundingClientRect().bottom>top);return {id:row.dataset.chatId,offset:row.getBoundingClientRect().top-top}})
 const sameAnchor=async expected=>{await settle();const actual=await anchor();assert.equal(actual.id,expected.id);assert.ok(Math.abs(actual.offset-expected.offset)<2,JSON.stringify({expected,actual}))}
 await settle();assert.ok((await pos()).gap<2,'first visit opens latest')
 await page.evaluate(()=>window.append(4));await settle();assert.ok((await pos()).gap<2,'following new messages stays at bottom')
 await up(1300);await page.waitForFunction(()=>document.querySelector('.chat-scroll-notice'))
 const reading=await anchor()
 await page.evaluate(()=>window.append(3));await sameAnchor(reading)
 assert.equal(await page.locator('.chat-scroll-notice').innerText(),'3 条新消息')
 await page.evaluate(()=>window.prepend());await sameAnchor(reading)
 assert.equal(await page.locator('.chat-scroll-notice').innerText(),'3 条新消息','history does not increment new messages')
 await page.evaluate(()=>window.rewrite());await sameAnchor(reading)
 assert.equal(await page.locator('.chat-scroll-notice').innerText(),'3 条新消息','content updates do not increment count')
 await page.evaluate(()=>window.trim());await sameAnchor(reading)
 await page.evaluate(()=>window.setHeight(340));await sameAnchor(reading)
 await page.getByRole('button',{name:'切换会话'}).click();await settle();assert.ok((await pos()).gap<2,'new private conversation starts at latest')
 await page.evaluate(()=>window.append(2));await settle()
 await page.getByRole('button',{name:'切换会话'}).click();await sameAnchor(reading)
 assert.equal(await page.locator('.chat-scroll-notice').innerText(),'5 条新消息','returning to paused conversation preserves position and accumulates unseen tail')
 await page.locator('.chat-scroll-notice').click();await settle();assert.ok((await pos()).gap<2)
 assert.equal(await page.locator('.chat-scroll-notice').count(),0)
 // Selecting the latest visible text pauses even while already at the bottom.
 await page.locator('[data-chat-id] p').last().evaluate(e=>{const range=document.createRange();range.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(range)})
 await page.waitForFunction(()=>document.querySelector('.chat-scroll-notice'))
 const selected=await anchor();await page.evaluate(()=>window.append(2));await sameAnchor(selected)
 await page.evaluate(()=>window.getSelection().removeAllRanges())
 await page.locator('.chat-thread').hover();await page.mouse.wheel(0,5000)
 await page.waitForFunction(()=>!document.querySelector('.chat-scroll-notice'))
 await page.evaluate(()=>window.append());await settle();assert.ok((await pos()).gap<2,'manual bottom restores following')
 await up(1200);await page.waitForFunction(()=>document.querySelector('.chat-scroll-notice'))
 await page.getByRole('button',{name:'发送',exact:true}).click();await settle();assert.ok((await pos()).gap<2,'explicit send returns to latest')
 await page.setViewportSize({width:390,height:844});await settle()
 await up(700);await page.waitForFunction(()=>document.querySelector('.chat-scroll-notice'))
 const mobile=await anchor();await page.evaluate(()=>window.append(12));await sameAnchor(mobile)
 const notice=await page.locator('.chat-scroll-notice').boundingBox(),composer=await page.locator('.chat-composer').boundingBox()
 assert.ok(notice.x>=0&&notice.x+notice.width<=390&&notice.y+notice.height<=composer.y,'mobile notice does not cover composer')
 mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/chat-scroll-mobile.png'})
 await page.setViewportSize({width:1000,height:900});await settle();await page.screenshot({path:'artifacts/chat-scroll-desktop.png'})
 assert.deepEqual(errors,[])
 console.log('PASS: follow, wheel pause, unread count, history prepend, translation height, trimming, resize, conversation restore, selection pause, manual resume, explicit send, mobile layout')
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
